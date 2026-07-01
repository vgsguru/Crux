import { createServerFn } from "@tanstack/react-start";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware.server";
import { z } from "zod";

// Server-side reverse geocode via Google Maps Geocoding API (avoids browser CORS,
// keeps the key off the client).
export const reverseGeocode = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .inputValidator((i: unknown) => z.object({ lat: z.number(), lng: z.number() }).parse(i))
  .handler(async ({ data }) => {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return { location: null as string | null, error: "Maps key not configured" };
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${data.lat},${data.lng}&key=${key}`);
    const d: any = await res.json();
    if (d.status !== "OK" || !d.results?.length) return { location: null as string | null, error: d.error_message || d.status };
    const comps = d.results[0].address_components as Array<{ long_name: string; types: string[] }>;
    const pick = (t: string) => comps.find((c) => c.types.includes(t))?.long_name;
    const city = pick("locality") || pick("postal_town") || pick("administrative_area_level_2") || pick("administrative_area_level_1");
    const country = pick("country");
    return { location: city ? [city, country].filter(Boolean).join(", ") : (d.results[0].formatted_address as string), error: null as string | null };
  });
