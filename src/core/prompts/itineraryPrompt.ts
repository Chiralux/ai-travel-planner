export const itinerarySystemPrompt = `You are an expert travel planner assistant.
You generate concise itineraries in strict JSON.
The JSON must match the provided schema fields without additional text.`;

export const itineraryUserPrompt = (
  input: {
    destination: string;
    startDate?: string;
    endDate?: string;
    days?: number;
    budget?: number;
    partySize?: number;
    preferences?: string[];
    specialNotes?: string;
  }
) => `Please craft an itinerary for the following trip request.
Respond with JSON only, no markdown, no explanation.

${JSON.stringify(input, null, 2)}`;
