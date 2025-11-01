import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadEnv } from "../../../../core/config/env";

const AMAP_PLACE_SEARCH_ENDPOINT = "https://restapi.amap.com/v3/place/text";

const querySchema = z.object({
	keywords: z
		.string()
		.trim()
		.min(1, "keywords is required")
		.max(60, "keywords is too long"),
	city: z.string().trim().max(20).optional()
});

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);
	const keywordsRaw = searchParams.get("q") ?? searchParams.get("keywords");
	const city = searchParams.get("city") ?? undefined;

	const parseResult = querySchema.safeParse({ keywords: keywordsRaw, city });

	if (!parseResult.success) {
		return NextResponse.json(
			{
				ok: false,
				error: parseResult.error.issues[0]?.message ?? "Invalid query parameters"
			},
			{ status: 400 }
		);
	}

	const env = loadEnv();
	const apiKey = env.AMAP_REST_KEY;

	if (!apiKey) {
		return NextResponse.json({ ok: false, error: "AMAP_REST_KEY is not configured" }, { status: 500 });
	}

	const { keywords } = parseResult.data;
	const url = new URL(AMAP_PLACE_SEARCH_ENDPOINT);
	url.searchParams.set("key", apiKey);
	url.searchParams.set("keywords", keywords);
	url.searchParams.set("offset", "10");
	url.searchParams.set("page", "1");
	url.searchParams.set("extensions", "base");
	url.searchParams.set("citylimit", "false");
	if (parseResult.data.city) {
		url.searchParams.set("city", parseResult.data.city);
	}

	try {
		const response = await fetch(url.toString(), { cache: "no-store" });

		if (!response.ok) {
			const text = await response.text();
			return NextResponse.json(
				{ ok: false, error: "Forward geocode upstream failed", status: response.status, details: text },
				{ status: 502 }
			);
		}

		const payload = (await response.json()) as {
			status?: string;
			info?: string;
			pois?: Array<{
				name?: string;
				address?: string;
				adname?: string;
				cityname?: string;
				pname?: string;
				location?: string;
				id?: string;
			}>;
		};

		if (payload.status !== "1" || !Array.isArray(payload.pois)) {
			return NextResponse.json(
				{ ok: false, error: payload.info ?? "Gaode forward geocode returned no result" },
				{ status: 502 }
			);
		}

		const suggestions = payload.pois
			.map((poi) => {
				if (typeof poi.location !== "string" || poi.location.trim().length === 0) {
					return null;
				}

				const [lngText, latText] = poi.location.split(",");
				const lng = Number.parseFloat(lngText);
				const lat = Number.parseFloat(latText);

				if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
					return null;
				}

				const displayName = poi.name?.trim();
				const segments = [poi.pname, poi.cityname, poi.adname, poi.address]
					.map((part) => part?.trim())
					.filter(Boolean);

				const subtitle = segments.join(" · ") || undefined;

				return {
					id: poi.id ?? `${lng.toFixed(6)},${lat.toFixed(6)}`,
					name: displayName ?? subtitle ?? "未知地点",
					subtitle: displayName && subtitle ? subtitle : undefined,
					lat,
					lng
				};
			})
			.filter((item): item is NonNullable<typeof item> => Boolean(item));

		return NextResponse.json({ ok: true, data: { suggestions } });
	} catch (error) {
		return NextResponse.json(
			{
				ok: false,
				error: "Forward geocode request failed",
				details: error instanceof Error ? error.message : String(error)
			},
			{ status: 500 }
		);
	}
}
