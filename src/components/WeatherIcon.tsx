import {
  Sun,
  Moon,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  CloudSun,
  CloudMoon,
  CloudMoonRain,
  Haze,
} from "lucide-react";

/**
 * Maps a WMO weather code + day/night flag to the correct icon.
 *
 * isDay defaults to true so that forecast-summary cards (which always
 * represent the full day) and any callsite that doesn't yet pass isDay
 * continue to show daytime icons rather than silently breaking.
 *
 * WMO codes where day/night makes a visual difference:
 *   0  clear sky     -> Sun (day) | Moon (night)
 *   1  mainly clear  -> CloudSun  | CloudMoon
 *   2  partly cloudy -> CloudSun  | CloudMoon
 * All other codes (overcast, fog, rain, snow, thunder) have no meaningful
 * day/night variant — the same icon is used regardless.
 */
export function WeatherIcon({
  code,
  isDay = true,
  className = "h-16 w-16",
}: {
  code: number;
  isDay?: boolean;
  className?: string;
}) {
  if (code === 0) {
    return isDay ? (
      <Sun className={className} strokeWidth={1.5} />
    ) : (
      <Moon className={className} strokeWidth={1.5} />
    );
  }
  if (code === 1 || code === 2) {
    return isDay ? (
      <CloudSun className={className} strokeWidth={1.5} />
    ) : (
      <CloudMoon className={className} strokeWidth={1.5} />
    );
  }
  if (code === 3) return <Cloud className={className} strokeWidth={1.5} />;
  if (code === 45 || code === 48) return <CloudFog className={className} strokeWidth={1.5} />;
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    // Light rain at night gets CloudMoonRain; heavy rain icon stays the same.
    return isDay || [63, 65, 82].includes(code) ? (
      <CloudRain className={className} strokeWidth={1.5} />
    ) : (
      <CloudMoonRain className={className} strokeWidth={1.5} />
    );
  }
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return <CloudSnow className={className} strokeWidth={1.5} />;
  if ([95, 96, 99].includes(code))
    return <CloudLightning className={className} strokeWidth={1.5} />;
  // Custom atmospheric codes (not WMO, assigned by Aeruvo Guard D):
  //   709 = Hazy    (moderate aerosol loading — one signal above threshold)
  //   710 = Smoke haze (elevated aerosol — two or more strong signals)
  if (code === 709 || code === 710)
    return <Haze className={className} strokeWidth={1.5} />;
  return <Cloud className={className} strokeWidth={1.5} />;
}
