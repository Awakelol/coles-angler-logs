// ---------------------------------------------------------------------------
// WEATHER
//
// Two interchangeable providers, both returning the same normalised shape so
// the dashboard never needs to know which one ran:
//
//   open-meteo  (default) — no API key, no signup, no rate limit for this use
//   openweather           — needs a free key; set it in Settings or js/config.js
//
// Add a provider by writing a fetch<Name>() that returns { current, hourly,
// daily } in the shape below and registering it in fetchWeather().
// ---------------------------------------------------------------------------

import { CONFIG } from '../config.js';

const WMO = {
  0: ['Clear', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'sun'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'cloud'], 48: ['Rime fog', 'cloud'],
  51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'cloud'], 73: ['Snow', 'cloud'], 75: ['Heavy snow', 'cloud'],
  80: ['Light showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Violent showers', 'rain'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm + hail', 'storm'], 99: ['Thunderstorm + hail', 'storm'],
};

export function describeCode(code) {
  return WMO[code] || ['—', 'cloud'];
}

export function compass(deg) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round((deg % 360) / 22.5) % 16];
}

/** Rough Beaufort-style read on whether it's fishable from a small boat. */
export function windAdvice(kph) {
  if (kph < 12) return { level: 'good', label: 'Calm — good for small boats' };
  if (kph < 25) return { level: 'ok', label: 'Moderate — workable inshore' };
  if (kph < 40) return { level: 'poor', label: 'Fresh — sheltered water only' };
  return { level: 'bad', label: 'Strong — stay in' };
}

async function fetchOpenMeteo({ lat, lon, timezone }) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,` +
    `wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure` +
    `&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,` +
    `precipitation_probability_max,wind_speed_10m_max,sunrise,sunset` +
    `&timezone=${encodeURIComponent(timezone || 'auto')}&forecast_days=5`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const d = await res.json();

  return {
    provider: 'Open-Meteo',
    current: {
      tempC: d.current.temperature_2m,
      feelsC: d.current.apparent_temperature,
      humidity: d.current.relative_humidity_2m,
      precipMm: d.current.precipitation,
      code: d.current.weather_code,
      windKph: d.current.wind_speed_10m,
      gustKph: d.current.wind_gusts_10m,
      windDeg: d.current.wind_direction_10m,
      pressure: d.current.surface_pressure,
      time: d.current.time,
    },
    hourly: (d.hourly?.time || []).map((t, i) => ({
      time: t,
      tempC: d.hourly.temperature_2m[i],
      pop: d.hourly.precipitation_probability?.[i],
      code: d.hourly.weather_code[i],
      windKph: d.hourly.wind_speed_10m[i],
    })),
    daily: (d.daily?.time || []).map((t, i) => ({
      date: t,
      code: d.daily.weather_code[i],
      maxC: d.daily.temperature_2m_max[i],
      minC: d.daily.temperature_2m_min[i],
      precipMm: d.daily.precipitation_sum[i],
      pop: d.daily.precipitation_probability_max?.[i],
      windKph: d.daily.wind_speed_10m_max[i],
      sunrise: d.daily.sunrise?.[i],
      sunset: d.daily.sunset?.[i],
    })),
  };
}

// OpenWeather's free tier has no hourly endpoint, so the 3-hourly forecast is
// collapsed into daily buckets to match the Open-Meteo shape.
const OW_TO_WMO = { Clear: 0, Clouds: 3, Rain: 63, Drizzle: 53, Thunderstorm: 95, Snow: 73, Mist: 45, Fog: 45, Haze: 45 };

async function fetchOpenWeather({ lat, lon }) {
  const key = CONFIG.weather.openWeatherKey;
  if (!key) throw new Error('No OpenWeather API key set — add one in Settings, or switch back to Open-Meteo.');

  const base = 'https://api.openweathermap.org/data/2.5';
  const [nowRes, fcRes] = await Promise.all([
    fetch(`${base}/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`),
    fetch(`${base}/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${key}`),
  ]);
  if (nowRes.status === 401) throw new Error('OpenWeather rejected the key. New keys take ~10 minutes to activate.');
  if (!nowRes.ok) throw new Error(`OpenWeather returned ${nowRes.status}`);
  const now = await nowRes.json();
  const fc = fcRes.ok ? await fcRes.json() : { list: [] };

  const days = new Map();
  for (const row of fc.list || []) {
    const date = row.dt_txt.slice(0, 10);
    if (!days.has(date)) days.set(date, { date, temps: [], winds: [], precip: 0, pops: [], code: OW_TO_WMO[row.weather[0].main] ?? 3 });
    const day = days.get(date);
    day.temps.push(row.main.temp);
    day.winds.push(row.wind.speed * 3.6);
    day.precip += row.rain?.['3h'] || 0;
    day.pops.push((row.pop || 0) * 100);
  }

  return {
    provider: 'OpenWeather',
    current: {
      tempC: now.main.temp,
      feelsC: now.main.feels_like,
      humidity: now.main.humidity,
      precipMm: now.rain?.['1h'] || 0,
      code: OW_TO_WMO[now.weather[0].main] ?? 3,
      windKph: now.wind.speed * 3.6,
      gustKph: now.wind.gust ? now.wind.gust * 3.6 : null,
      windDeg: now.wind.deg,
      pressure: now.main.pressure,
      time: new Date(now.dt * 1000).toISOString(),
    },
    hourly: (fc.list || []).slice(0, 24).map((r) => ({
      time: r.dt_txt.replace(' ', 'T'),
      tempC: r.main.temp,
      pop: Math.round((r.pop || 0) * 100),
      code: OW_TO_WMO[r.weather[0].main] ?? 3,
      windKph: r.wind.speed * 3.6,
    })),
    daily: [...days.values()].slice(0, 5).map((d) => ({
      date: d.date,
      code: d.code,
      maxC: Math.max(...d.temps),
      minC: Math.min(...d.temps),
      precipMm: Number(d.precip.toFixed(1)),
      pop: Math.round(Math.max(...d.pops)),
      windKph: Math.max(...d.winds),
      sunrise: null,
      sunset: null,
    })),
  };
}

export async function fetchWeather(coords, timezone) {
  const provider = CONFIG.weather.provider;
  const args = { ...coords, timezone };
  if (provider === 'openweather') return fetchOpenWeather(args);
  return fetchOpenMeteo(args);
}
