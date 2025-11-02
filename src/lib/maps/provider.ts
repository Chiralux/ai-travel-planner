export type MapProvider = "amap" | "google";

export type Coordinate = {
  lat: number;
  lng: number;
};

const CHINA_LATITUDE_RANGE = { min: 3.5, max: 53.6 };
const CHINA_LONGITUDE_RANGE = { min: 73.5, max: 134.8 };

export type BoundingBox = {
  north: number;
  south: number;
  east: number;
  west: number;
};

const GLOBAL_BOUNDS: BoundingBox = {
  north: 85.0,
  south: -85.0,
  east: 180,
  west: -180
};

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidCoordinate(candidate: Coordinate | null | undefined): candidate is Coordinate {
  return Boolean(candidate && isFiniteNumber(candidate.lat) && isFiniteNumber(candidate.lng));
}

export function isCoordinateInChina(coordinate: Coordinate | null | undefined): boolean {
  if (!isValidCoordinate(coordinate)) {
    return false;
  }

  const { lat, lng } = coordinate;

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return false;
  }

  return (
    lat >= CHINA_LATITUDE_RANGE.min &&
    lat <= CHINA_LATITUDE_RANGE.max &&
    lng >= CHINA_LONGITUDE_RANGE.min &&
    lng <= CHINA_LONGITUDE_RANGE.max
  );
}

export function pickMapProvider(
  coordinates: Coordinate[],
  options?: {
    defaultProvider?: MapProvider;
    googleMapsAvailable?: boolean;
    googleMapsStrictCountries?: string[];
    fallbackCenter?: Coordinate;
  }
): MapProvider {
  const defaultProvider = options?.defaultProvider ?? "amap";
  const googleAvailable = options?.googleMapsAvailable ?? true;

  if (!googleAvailable) {
    return defaultProvider;
  }

  const hasForeignCoordinates = coordinates.some((coordinate) => coordinate && !isCoordinateInChina(coordinate));

  if (hasForeignCoordinates) {
    return "google";
  }

  return defaultProvider;
}
