import { Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudSun } from "lucide-react";

export function WeatherIcon({ code, className = "h-16 w-16" }: { code: number; className?: string }) {
  if (code === 0) return <Sun className={className} strokeWidth={1.5} />;
  if ([1, 2].includes(code)) return <CloudSun className={className} strokeWidth={1.5} />;
  if (code === 3) return <Cloud className={className} strokeWidth={1.5} />;
  if ([45, 48].includes(code)) return <CloudFog className={className} strokeWidth={1.5} />;
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return <CloudRain className={className} strokeWidth={1.5} />;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return <CloudSnow className={className} strokeWidth={1.5} />;
  if ([95, 96, 99].includes(code)) return <CloudLightning className={className} strokeWidth={1.5} />;
  return <Cloud className={className} strokeWidth={1.5} />;
}