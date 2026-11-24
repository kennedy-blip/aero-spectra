"""ISO 7730 thermal comfort, psychrometrics and CFK-inspired COHb kinetics."""
from __future__ import annotations
import math


def saturation_vapor_pressure_kpa(temp_c: float) -> float:
    return 0.61094 * math.exp(17.625 * temp_c / (temp_c + 243.04))


def dew_point_c(temp_c: float, rh: float) -> float:
    rh_fraction = max(0.01, min(100.0, rh)) / 100.0
    gamma = math.log(rh_fraction) + 17.625 * temp_c / (243.04 + temp_c)
    return 243.04 * gamma / (17.625 - gamma)


def wet_bulb_c(temp_c: float, rh: float, pressure_kpa: float = 101.325) -> float:
    """Solve the ventilated psychrometer equation for wet-bulb temperature."""
    ta = float(temp_c)
    actual_vapor = saturation_vapor_pressure_kpa(ta) * max(0.01, min(100.0, rh)) / 100.0
    low, high = max(-25.0, ta - 35.0), ta
    for _ in range(48):
        tw = (low + high) / 2.0
        coefficient = 0.00066 * (1.0 + 0.00115 * tw) * pressure_kpa
        predicted_vapor = saturation_vapor_pressure_kpa(tw) - coefficient * (ta - tw)
        if predicted_vapor > actual_vapor:
            high = tw
        else:
            low = tw
    return (low + high) / 2.0


def humidity_ratio_g_kg(temp_c: float, rh: float, pressure_kpa: float = 101.325) -> float:
    pv = saturation_vapor_pressure_kpa(temp_c) * max(0.0, min(100.0, rh)) / 100.0
    return 1000.0 * 0.62198 * pv / max(0.1, pressure_kpa - pv)


def fanger_pmv(air_c=22.5, radiant_c=22.5, velocity_ms=0.1, rh=45.0, met=1.1, clo=0.7,
               surface_c=17.0, pressure_kpa=101.325) -> dict:
    ta, tr, vel = float(air_c), float(radiant_c), max(0.01, float(velocity_ms))
    m = max(0.8, float(met)) * 58.15
    w = 0.0
    icl = max(0.01, float(clo)) * 0.155
    fcl = 1 + 1.29 * icl if icl <= 0.078 else 1.05 + 0.645 * icl
    pa = saturation_vapor_pressure_kpa(ta) * max(0.0, min(100.0, rh)) * 10.0
    hcf = 12.1 * math.sqrt(vel)
    tcl = ta + (35.5 - ta) / (3.5 * icl + 0.1)
    hc = hcf
    for _ in range(150):
        hc = max(hcf, 2.38 * abs(tcl - ta) ** 0.25)
        radiation = 3.96e-8 * fcl * ((tcl + 273) ** 4 - (tr + 273) ** 4)
        convection = fcl * hc * (tcl - ta)
        next_tcl = 35.7 - 0.028 * (m - w) - icl * (radiation + convection)
        if not math.isfinite(next_tcl):
            break
        if abs(next_tcl - tcl) < 0.0001:
            tcl = next_tcl
            break
        tcl = 0.5 * tcl + 0.5 * next_tcl
    loss = (3.05e-3 * (5733 - 6.99 * m - pa)
            + (0.42 * (m - 58.15) if m > 58.15 else 0)
            + 1.7e-5 * m * (5867 - pa) + 0.0014 * m * (34 - ta)
            + 3.96e-8 * fcl * ((tcl + 273) ** 4 - (tr + 273) ** 4)
            + fcl * hc * (tcl - ta))
    pmv = (0.303 * math.exp(-0.036 * m) + 0.028) * (m - loss)
    ppd = 100 - 95 * math.exp(-0.03353 * pmv ** 4 - 0.2179 * pmv ** 2)
    dew_point = dew_point_c(ta, rh)
    humidity_ratio = humidity_ratio_g_kg(ta, rh, pressure_kpa)
    humidity_fraction = humidity_ratio / 1000.0
    enthalpy = 1.006 * ta + humidity_fraction * (2501.0 + 1.86 * ta)
    surface_water_activity = min(1.5, saturation_vapor_pressure_kpa(dew_point) / max(0.0001, saturation_vapor_pressure_kpa(float(surface_c))))
    return {"pmv": max(-3.0, min(3.0, pmv)), "ppd": max(5.0, min(100.0, ppd)),
            "clothing_surface_c": tcl, "dew_point_c": dew_point,
            "wet_bulb_c": wet_bulb_c(ta, rh, pressure_kpa),
            "humidity_ratio_g_kg": humidity_ratio, "enthalpy_kj_kg": enthalpy,
            "surface_water_activity": max(0.0, min(1.5, surface_water_activity))}


def cohb_derivative(cohb_percent: float, co_ppm: float, ventilation_l_min: float = 8.0,
                    barometric_mmhg: float = 760.0, half_life_min: float = 320.0) -> float:
    """Haldane M=218 equilibrium with RK4-ready first-order uptake/washout approximation."""
    dry_pressure = max(100.0, barometric_mmhg - 47.0)
    p_i_co = max(0.0, co_ppm) * 1e-6 * dry_pressure
    p_alv_o2 = 0.2095 * dry_pressure
    m_affinity = 218.0
    equilibrium = 100.0 * m_affinity * p_i_co / (p_alv_o2 + m_affinity * p_i_co)
    ventilation_factor = max(0.55, min(3.5, ventilation_l_min / 8.0))
    uptake_rate = math.log(2) / (210.0 / ventilation_factor)
    washout_rate = math.log(2) / max(8.0, half_life_min)
    return uptake_rate * (equilibrium - cohb_percent) - washout_rate * cohb_percent


def integrate_cohb(co_ppm: float, duration_min: float, start_percent: float = 0.8,
                   ventilation_l_min: float = 8.0, barometric_mmhg: float = 760.0,
                   oxygen_half_life_min: float = 320.0, step_min: float = 1.0) -> list[dict]:
    h = max(0.1, min(5.0, step_min))
    count = max(1, math.ceil(duration_min / h))
    c = max(0.0, start_percent)
    points = [{"minute": 0.0, "cohb_percent": c}]
    for i in range(count):
        dt = min(h, duration_min - i * h)
        f = lambda value: cohb_derivative(value, co_ppm, ventilation_l_min, barometric_mmhg, oxygen_half_life_min)
        k1 = f(c); k2 = f(c + dt * k1 / 2); k3 = f(c + dt * k2 / 2); k4 = f(c + dt * k3)
        c = max(0.0, min(70.0, c + dt * (k1 + 2*k2 + 2*k3 + k4) / 6))
        if i % max(1, round(count / 80)) == 0 or i == count - 1:
            points.append({"minute": min(duration_min, (i + 1) * h), "cohb_percent": c})
    return points
