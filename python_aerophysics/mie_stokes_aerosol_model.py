"""Aerosol optical, Mie-series, Brownian and settling helpers.

The routines return model values only. Real-world PM mass requires calibrated collection
volume, shape/density and optical response measurements.
"""
from __future__ import annotations
import cmath
import math

BOLTZMANN_J_K = 1.380649e-23
PM25_BREAKPOINTS = ((0.0, 9.0, 0, 50), (9.1, 35.4, 51, 100), (35.5, 55.4, 101, 150),
                    (55.5, 125.4, 151, 200), (125.5, 225.4, 201, 300), (225.5, 325.4, 301, 500))


def cunningham_slip(diameter_um: float, mean_free_path_um: float = 0.066) -> float:
    d = max(float(diameter_um), 0.03)
    ratio = mean_free_path_um / d
    return 1.0 + ratio * (2.514 + 0.8 * math.exp(-0.55 / ratio))


def stokes_settling_mm_s(diameter_um: float, density_kg_m3: float = 1400.0, viscosity_pa_s: float = 1.81e-5) -> float:
    diameter_m = max(float(diameter_um), 0.03) * 1e-6
    return density_kg_m3 * diameter_m ** 2 * 9.80665 * cunningham_slip(diameter_um) / (18.0 * viscosity_pa_s) * 1000.0


def brownian_diffusivity_m2_s(diameter_um: float, temperature_k: float = 293.15, viscosity_pa_s: float = 1.81e-5) -> float:
    diameter_m = max(float(diameter_um), 0.03) * 1e-6
    cc = cunningham_slip(diameter_um)
    return BOLTZMANN_J_K * temperature_k * cc / (3.0 * math.pi * viscosity_pa_s * diameter_m)


def _spherical_j_miller(z: complex, nmax: int) -> list[complex]:
    """Miller downward recurrence for spherical Bessel j_n(z), normalized at j_0."""
    if abs(z) < 1e-10:
        return [1.0 + 0j] + [0j] * nmax
    extra = max(18, int(abs(z) ** (1.0 / 3.0)) + 8)
    top = max(nmax + extra, int(abs(z)) + extra)
    values = [0j] * (top + 2)
    values[top] = 1.0 + 0j
    for n in range(top, 0, -1):
        values[n - 1] = ((2.0 * n + 1.0) / z) * values[n] - values[n + 1]
        if abs(values[n - 1]) > 1e120:
            for index in range(n - 1, top + 2):
                values[index] *= 1e-120
    exact_j0 = cmath.sin(z) / z
    if abs(values[0]) < 1e-290:
        raise ArithmeticError("Miller recurrence normalization underflow")
    scale = exact_j0 / values[0]
    return [value * scale for value in values[:nmax + 1]]


def mie_size_response(diameter_um: float, wavelength_nm: float = 630.0, refractive_index: float = 1.45) -> dict:
    """Size parameter plus a smooth optical response envelope for quick UI display."""
    x = math.pi * diameter_um * 1000.0 / wavelength_nm
    m = (refractive_index - 1.0) / (refractive_index + 2.0)
    response = (6.0 * math.pi * m * m * x ** 4 / (1.0 + x ** 4)) * (0.58 + 0.42 * math.sin(1.7 * x + 0.4) ** 2)
    return {"size_parameter": x, "relative_intensity": max(0.0, response),
            "regime": "Rayleigh" if x < 0.3 else ("Mie" if x < 20 else "geometric")}


def mie_scattering_intensity(diameter_um: float, wavelength_nm: float = 630.0,
                             refractive_index: complex = 1.45 + 0.0j,
                             theta_degrees: float = 90.0) -> dict:
    """Homogeneous-sphere Mie series returning polarized phase intensities I1/I2.

    Refractive index is relative to the surrounding medium; intensities are dimensionless
    amplitudes (not a calibrated cross-section). Miller recurrence stabilizes j_n terms.
    """
    wavelength_m = max(1e-12, float(wavelength_nm) * 1e-9)
    radius_m = max(0.0, float(diameter_um)) * 0.5e-6
    x = 2.0 * math.pi * radius_m / wavelength_m
    if x <= 1e-8:
        return {"size_parameter": x, "i1": 0.0, "i2": 0.0, "unpolarized": 0.0, "terms": 0}
    m = complex(refractive_index)
    nmax = max(1, int(max(x, abs(m * x)) + 4.0 * max(x, abs(m * x)) ** (1.0 / 3.0) + 2.0))
    mx = m * x
    psi_x_j = _spherical_j_miller(complex(x), nmax + 1)
    psi_m_j = _spherical_j_miller(mx, nmax + 1)
    psi_x = [x * value for value in psi_x_j]
    psi_m = [mx * value for value in psi_m_j]
    chi_x = [0j] * (nmax + 2)
    chi_x[0] = complex(math.cos(x), 0.0)
    chi_x[1] = complex(math.cos(x) / x + math.sin(x), 0.0)
    y_prev = -math.cos(x) / x
    y_curr = -math.cos(x) / (x * x) - math.sin(x) / x
    chi_x[1] = complex(-x * y_curr, 0.0)
    for n in range(1, nmax + 1):
        y_next = (2.0 * n + 1.0) * y_curr / x - y_prev
        chi_x[n + 1] = complex(-x * y_next, 0.0)
        y_prev, y_curr = y_curr, y_next
    dpsi_x = [0j] * (nmax + 1)
    dpsi_m = [0j] * (nmax + 1)
    dchi_x = [0j] * (nmax + 1)
    dpsi_x[0] = complex(math.cos(x), 0.0)
    dpsi_m[0] = cmath.cos(mx)
    dchi_x[0] = complex(-math.sin(x), 0.0)
    for n in range(1, nmax + 1):
        dpsi_x[n] = psi_x[n - 1] - n * psi_x[n] / x
        dpsi_m[n] = psi_m[n - 1] - n * psi_m[n] / mx
        dchi_x[n] = chi_x[n - 1] - n * chi_x[n] / x
    xi_x = [psi_x[n] - 1j * chi_x[n] for n in range(nmax + 1)]
    dxi_x = [dpsi_x[n] - 1j * dchi_x[n] for n in range(nmax + 1)]
    a_coefficients: list[complex] = []
    b_coefficients: list[complex] = []
    for n in range(1, nmax + 1):
        numerator_a = m * psi_m[n] * dpsi_x[n] - psi_x[n] * dpsi_m[n]
        denominator_a = m * psi_m[n] * dxi_x[n] - xi_x[n] * dpsi_m[n]
        numerator_b = psi_m[n] * dpsi_x[n] - m * psi_x[n] * dpsi_m[n]
        denominator_b = psi_m[n] * dxi_x[n] - m * xi_x[n] * dpsi_m[n]
        a_coefficients.append(numerator_a / denominator_a if abs(denominator_a) > 1e-300 else 0j)
        b_coefficients.append(numerator_b / denominator_b if abs(denominator_b) > 1e-300 else 0j)
    mu = math.cos(math.radians(float(theta_degrees)))
    pi_nm1, pi_n = 0.0, 1.0
    s1, s2 = 0j, 0j
    for n in range(1, nmax + 1):
        if n > 1:
            pi_next = ((2.0 * n - 1.0) / (n - 1.0)) * mu * pi_n - (n / (n - 1.0)) * pi_nm1
            pi_nm1, pi_n = pi_n, pi_next
        tau_n = n * mu * pi_n - (n + 1.0) * pi_nm1
        factor = (2.0 * n + 1.0) / (n * (n + 1.0))
        a_n, b_n = a_coefficients[n - 1], b_coefficients[n - 1]
        s1 += factor * (a_n * pi_n + b_n * tau_n)
        s2 += factor * (a_n * tau_n + b_n * pi_n)
    i1, i2 = abs(s1) ** 2, abs(s2) ** 2
    return {"size_parameter": x, "i1": i1, "i2": i2, "unpolarized": 0.5 * (i1 + i2), "terms": nmax}


def epa_pm25_aqi(pm25_ug_m3: float) -> int:
    concentration = math.floor(max(0.0, min(500.0, float(pm25_ug_m3))) * 10.0 + 0.5) / 10.0
    band = next((b for b in PM25_BREAKPOINTS if b[0] <= concentration <= b[1]), PM25_BREAKPOINTS[-1])
    c_lo, c_hi, i_lo, i_hi = band
    return max(0, min(500, round((i_hi - i_lo) / (c_hi - c_lo) * (concentration - c_lo) + i_lo)))


def lognormal_distribution(pm25: float, pm10: float) -> list[dict]:
    edges = [0.3, 0.45, 0.65, 0.9, 1.2, 1.6, 2.1, 2.5, 3.5, 5, 7.5, 10, 25]
    output = []
    for lo, hi in zip(edges, edges[1:]):
        d = math.sqrt(lo * hi)
        fine = max(0.0, pm25) * math.exp(-0.5 * (math.log(d / 0.65) / 0.72) ** 2)
        coarse = max(0.0, pm10 - pm25) * math.exp(-0.5 * (math.log(d / 5.5) / 0.62) ** 2)
        output.append({"from_um": lo, "to_um": hi, "count_index": max(0.4, fine + coarse)})
    return output


def mass_from_particles(particles: list[dict], sample_volume_cm3: float = 1.0) -> float:
    """Convert spherical particle diameters in µm to µg/m³ at a supplied sample volume."""
    volume_m3 = max(sample_volume_cm3, 1e-9) * 1e-6
    mass_kg = 0.0
    for particle in particles:
        diameter_m = max(0.0, float(particle.get("diameter_um", 0))) * 1e-6
        density = float(particle.get("density_kg_m3", 1400.0))
        mass_kg += math.pi / 6.0 * diameter_m ** 3 * density
    return mass_kg / volume_m3 * 1e9
