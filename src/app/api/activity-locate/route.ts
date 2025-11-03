import { NextRequest, NextResponse } from "next/server";
import type { Dispatcher } from "undici";
import { z } from "zod";
import { loadEnv } from "../../../core/config/env";
import { geocodeAddressWithGoogle } from "../../../adapters/maps/googleGeocode";
import { isValidCoordinate } from "../../../lib/maps/provider";
import { GEOCODED_CONFIDENCE } from "../../../services/ItineraryService";
import { generateAddressCandidates } from "../../../core/utils/addressCandidates";
import { getGoogleMapsDispatcher } from "../../../adapters/maps/googleDispatcher";

const FIND_PLACE_ENDPOINT = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";
const MAX_ANCHOR_DISTANCE_METERS = 150_000;

const requestSchema = z.object({
	destination: z.string().min(1),
	anchor: z
		.object({
			lat: z.number(),
			lng: z.number()
		})
		.optional(),
	activity: z.object({
		title: z.string().min(1),
		note: z.string().optional(),
		address: z.string().optional(),
		lat: z.number().optional(),
		lng: z.number().optional(),
		maps_confidence: z.number().min(0).max(1).optional()
	})
});

const ADDRESS_RESOLUTION_NOTE = "已根据详细地址自动定位，请核实。";

function containsHanCharacters(value: string | undefined): boolean {
	if (!value) {
		return false;
	}

	return /[\p{Script=Han}]/u.test(value);
}

type GeocodeResult = {
	coordinate: { lat: number; lng: number };
	address?: string;
	placeId?: string;
};

type FindPlaceResult = {
	placeId: string;
	coordinate?: { lat: number; lng: number };
	address?: string;
};

function toRadians(value: number): number {
	return (value * Math.PI) / 180;
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	const R = 6371000;
	const phi1 = toRadians(a.lat);
	const phi2 = toRadians(b.lat);
	const deltaPhi = toRadians(b.lat - a.lat);
	const deltaLambda = toRadians(b.lng - a.lng);

	const sinDeltaPhi = Math.sin(deltaPhi / 2);
	const sinDeltaLambda = Math.sin(deltaLambda / 2);

	const h = sinDeltaPhi * sinDeltaPhi + Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda;
	return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function buildLocationBias(anchor?: { lat: number; lng: number }): string | undefined {
	if (!anchor || !isValidCoordinate(anchor)) {
		return undefined;
	}

	return `point:${anchor.lat},${anchor.lng}`;
}

async function findPlaceByAddress(
	query: string,
	apiKey: string,
	language: string,
	locationBias?: string
): Promise<FindPlaceResult | null> {
	const trimmed = query.trim();

	if (!trimmed) {
		return null;
	}

	const url = new URL(FIND_PLACE_ENDPOINT);
	url.searchParams.set("input", trimmed.slice(0, 240));
	url.searchParams.set("inputtype", "textquery");
	url.searchParams.set("fields", "place_id,geometry/location,formatted_address");
	url.searchParams.set("key", apiKey);
	url.searchParams.set("language", language);

	if (locationBias) {
		url.searchParams.set("locationbias", locationBias);
	}

		const dispatcher = getGoogleMapsDispatcher();
		const fetchInit: RequestInit & { dispatcher?: Dispatcher } = {
		cache: "no-store"
	};

	if (dispatcher) {
		fetchInit.dispatcher = dispatcher;
	}

	try {
		const response = await fetch(url.toString(), fetchInit);

		if (!response.ok) {
			return null;
		}

		const payload = (await response.json()) as {
			status?: string;
			candidates?: Array<{
				place_id?: string;
				formatted_address?: string;
				geometry?: { location?: { lat?: number; lng?: number } };
			}>;
		};

		if (!payload || payload.status !== "OK" || !Array.isArray(payload.candidates) || payload.candidates.length === 0) {
			return null;
		}

		const candidate = payload.candidates[0];

		if (!candidate?.place_id) {
			return null;
		}

		const location = candidate.geometry?.location;
		const lat = typeof location?.lat === "number" ? location.lat : undefined;
		const lng = typeof location?.lng === "number" ? location.lng : undefined;

		const result: FindPlaceResult = {
			placeId: candidate.place_id,
			address: candidate.formatted_address ?? undefined
		};

		if (
			typeof lat === "number" &&
			Number.isFinite(lat) &&
			typeof lng === "number" &&
			Number.isFinite(lng)
		) {
			result.coordinate = { lat, lng };
		}

		return result;
	} catch (error) {
		if (process.env.NODE_ENV !== "production") {
			console.warn("[ActivityLocate] Find place request failed", { query, error });
		}

		return null;
	}
}

async function geocodeWithGoogle(
	query: string,
	apiKey: string,
	language: string,
	region?: string
): Promise<GeocodeResult | null> {
	const result = await geocodeAddressWithGoogle({
		address: query,
		apiKey,
		language,
		region
	});

	if (!result) {
		return null;
	}

	const coordinate = { lat: result.lat, lng: result.lng };

	if (!isValidCoordinate(coordinate)) {
		return null;
	}

	return {
		coordinate,
		address: result.formattedAddress,
		placeId: result.placeId
	};
}

export async function POST(request: NextRequest) {
	let payload: unknown;

	try {
		payload = await request.json();
	} catch {
		return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = requestSchema.safeParse(payload);

	if (!parsed.success) {
		return NextResponse.json(
			{ ok: false, error: "Invalid payload", details: parsed.error.flatten() },
			{ status: 400 }
		);
	}

	const { destination, activity, anchor } = parsed.data;
	const locationBias = buildLocationBias(anchor);

	if (
		typeof activity.lat === "number" &&
		Number.isFinite(activity.lat) &&
		typeof activity.lng === "number" &&
		Number.isFinite(activity.lng)
	) {
		return NextResponse.json({
			ok: true,
			data: {
				lat: activity.lat,
				lng: activity.lng,
				address: activity.address,
				maps_confidence: activity.maps_confidence,
				note: activity.note
			}
		});
	}

	const addressValue = activity.address?.trim();

	if (!addressValue) {
		return NextResponse.json({ ok: true, data: {} }, { status: 200 });
	}

	const env = loadEnv();
	const googleApiKey = env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

	if (!googleApiKey) {
		return NextResponse.json({ ok: true, data: {} }, { status: 200 });
	}

	const language = containsHanCharacters(activity.address ?? destination) ? "zh-CN" : "en";
	const queries = generateAddressCandidates(addressValue);

	if (queries.length === 0) {
		return NextResponse.json({ ok: true, data: {} }, { status: 200 });
	}

		for (const query of queries) {
		try {
				const placeResult = await findPlaceByAddress(query, googleApiKey, language, locationBias);

				if (placeResult) {
					if (placeResult.coordinate && anchor && distanceMeters(anchor, placeResult.coordinate) > MAX_ANCHOR_DISTANCE_METERS) {
						// Skip candidates that are far from the provided anchor to avoid cross-country mismatches.
						continue;
					}

					let resolvedCoordinate = placeResult.coordinate;
					let resolvedPlaceId = placeResult.placeId;
					let resolvedAddress = placeResult.address;

					if (!resolvedCoordinate || !isValidCoordinate(resolvedCoordinate)) {
						const geocodedFallback = await geocodeWithGoogle(query, googleApiKey, language);

						if (geocodedFallback?.coordinate && isValidCoordinate(geocodedFallback.coordinate)) {
							resolvedCoordinate = geocodedFallback.coordinate;
							if (geocodedFallback.placeId && !resolvedPlaceId) {
								resolvedPlaceId = geocodedFallback.placeId;
							}
							if (geocodedFallback.address && !resolvedAddress) {
								resolvedAddress = geocodedFallback.address;
							}
						} else {
							continue;
						}
					}

					if (!resolvedCoordinate || !isValidCoordinate(resolvedCoordinate)) {
						continue;
					}

					const responsePayload: {
						lat: number;
						lng: number;
						address?: string;
						note?: string;
						maps_confidence?: number;
						provider: "google";
						resolution: "address";
						place_id?: string;
					} = {
						lat: resolvedCoordinate.lat,
						lng: resolvedCoordinate.lng,
						provider: "google",
						resolution: "address",
						place_id: resolvedPlaceId
					};

					if (resolvedAddress) {
						responsePayload.address = resolvedAddress;
					}

					const noteAddition = ADDRESS_RESOLUTION_NOTE;
					const existingNote = activity.note ?? "";

					if (!existingNote.includes(noteAddition)) {
						responsePayload.note = existingNote ? `${existingNote}（${noteAddition}）` : noteAddition;
					}

					const nextConfidence = Math.max(activity.maps_confidence ?? 0, GEOCODED_CONFIDENCE);
					responsePayload.maps_confidence = Math.min(Math.max(nextConfidence, 0), 1);

					return NextResponse.json({ ok: true, data: responsePayload }, { status: 200 });
				}

			const result = await geocodeWithGoogle(query, googleApiKey, language);

			if (!result) {
				continue;
			}

			const responsePayload: {
				lat: number;
				lng: number;
				address?: string;
				note?: string;
				maps_confidence?: number;
				provider: "google";
				resolution: "address";
					place_id?: string;
			} = {
				lat: result.coordinate.lat,
				lng: result.coordinate.lng,
				provider: "google",
				resolution: "address"
			};

			if (result.address) {
				responsePayload.address = result.address;
			}

				if (result.placeId) {
					responsePayload.place_id = result.placeId;
				}

			const noteAddition = ADDRESS_RESOLUTION_NOTE;
			const existingNote = activity.note ?? "";

			if (!existingNote.includes(noteAddition)) {
				responsePayload.note = existingNote
					? `${existingNote}（${noteAddition}）`
					: noteAddition;
			}

			const nextConfidence = Math.max(activity.maps_confidence ?? 0, GEOCODED_CONFIDENCE);
			responsePayload.maps_confidence = Math.min(Math.max(nextConfidence, 0), 1);

			return NextResponse.json({ ok: true, data: responsePayload }, { status: 200 });
		} catch (error) {
			if (process.env.NODE_ENV !== "production") {
				console.warn("[ActivityLocate] Google geocode failed", { query, error });
			}
		}
	}

	return NextResponse.json({ ok: true, data: {} }, { status: 200 });
}
