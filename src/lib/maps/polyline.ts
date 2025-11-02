export type PolylinePoint = { lat: number; lng: number };

function decodeValue(encoded: string, indexRef: { value: number }): number {
  let result = 0;
  let shift = 0;
  let byte: number;

  do {
    if (indexRef.value >= encoded.length) {
      throw new Error("Polyline decoding failed: unexpected end");
    }

    byte = encoded.charCodeAt(indexRef.value) - 63;
    indexRef.value += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  const shouldNegate = result & 1;
  const decoded = shouldNegate ? ~(result >> 1) : result >> 1;

  return decoded;
}

export function decodePolyline(encoded: string): PolylinePoint[] {
  if (!encoded || typeof encoded !== "string") {
    return [];
  }

  const points: PolylinePoint[] = [];
  const indexRef = { value: 0 };
  let lat = 0;
  let lng = 0;

  while (indexRef.value < encoded.length) {
    try {
      lat += decodeValue(encoded, indexRef);
      lng += decodeValue(encoded, indexRef);
    } catch {
      break;
    }

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}
