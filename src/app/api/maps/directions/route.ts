import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadEnv } from "../../../../core/config/env";

const requestSchema = z.object({
	origin: z.object({
		lat: z.number(),
		lng: z.number()
	}),
	destination: z.object({
		lat: z.number(),
		lng: z.number()
	}),
		strategy: z
			.union([
				z.literal("0"),
				z.literal("1"),
				z.literal("2"),
				z.literal("3"),
				z.literal("4"),
				z.literal("5"),
				z.literal("6"),
				z.literal("7"),
				z.literal("8"),
				z.literal("9"),
				z.literal("10"),
				z.literal("11")
			])
			.optional()
});

const GAODE_DIRECTION_URL = "https://restapi.amap.com/v3/direction/driving";

type GaodeDirectionResponse = {
	status?: string;
	info?: string;
	infocode?: string;
	route?: {
		paths?: Array<{
			distance?: string;
			duration?: string;
			steps?: Array<{
				polyline?: string;
			}>;
		}>;
	};
};

const parsePolyline = (steps: Array<{ polyline?: string }> | undefined): Array<{ lat: number; lng: number }> => {
	if (!Array.isArray(steps)) {
		return [];
	}

	const points: Array<{ lat: number; lng: number }> = [];

	for (const step of steps) {
		if (!step?.polyline) {
			continue;
		}

		const segments = step.polyline.split(";");

		for (const segment of segments) {
			const [lngText, latText] = segment.split(",");
			const lng = Number.parseFloat(lngText);
			const lat = Number.parseFloat(latText);

			if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
				continue;
			}

			const isDuplicate = points.length > 0 && Math.abs(points[points.length - 1].lat - lat) < 1e-6 && Math.abs(points[points.length - 1].lng - lng) < 1e-6;

			if (!isDuplicate) {
				points.push({ lat, lng });
			}
		}
	}

	return points;
};

export async function POST(request: NextRequest) {
	const env = loadEnv();

	if (!env.AMAP_REST_KEY) {
		return NextResponse.json({ ok: false, error: "AMAP_REST_KEY not configured" }, { status: 500 });
	}

	let payload: z.infer<typeof requestSchema>;

	try {
		const json = await request.json();
		payload = requestSchema.parse(json);
	} catch (error) {
		return NextResponse.json({ ok: false, error: "Invalid request payload" }, { status: 400 });
	}

	const origin = `${payload.origin.lng},${payload.origin.lat}`;
	const destination = `${payload.destination.lng},${payload.destination.lat}`;

	const url = new URL(GAODE_DIRECTION_URL);
	url.searchParams.set("key", env.AMAP_REST_KEY);
	url.searchParams.set("origin", origin);
	url.searchParams.set("destination", destination);
	url.searchParams.set("extensions", "base");
	url.searchParams.set("strategy", payload.strategy ?? "0");

	let upstreamJson: GaodeDirectionResponse;
	let upstreamStatus = 200;

	try {
		const upstream = await fetch(url.toString(), { cache: "no-store" });
		upstreamStatus = upstream.status;
		upstreamJson = (await upstream.json()) as GaodeDirectionResponse;
	} catch (error) {
		return NextResponse.json({ ok: false, error: "Failed to reach Gaode API" }, { status: 502 });
	}

	if (!upstreamJson || upstreamJson.status !== "1" || !upstreamJson.route?.paths?.length) {
		const message = upstreamJson?.info ?? "Gaode API returned no route";
		return NextResponse.json(
			{
				ok: false,
				error: message,
				details: upstreamJson,
				status: upstreamStatus
			},
			{ status: 502 }
		);
	}

	const primaryPath = upstreamJson.route.paths[0];
		const parsedDistance = Number.parseInt(primaryPath?.distance ?? "0", 10);
		const parsedDuration = Number.parseInt(primaryPath?.duration ?? "0", 10);
		const distanceMeters = Number.isFinite(parsedDistance) ? parsedDistance : 0;
		const durationSeconds = Number.isFinite(parsedDuration) ? parsedDuration : 0;
	const points = parsePolyline(primaryPath?.steps);

	if (points.length < 2) {
		return NextResponse.json(
			{
				ok: false,
				error: "Failed to parse route polyline",
				details: upstreamJson
			},
			{ status: 502 }
		);
	}

	return NextResponse.json({
		ok: true,
		data: {
					points,
					distanceMeters,
					durationSeconds
		}
	});
}
