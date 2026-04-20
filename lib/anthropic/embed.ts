// Voyage AI embeddings (1024-dim, voyage-3). Optional — gated on VOYAGE_API_KEY.
// If not configured, returns null and callers skip vector dedup.

export async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input: text.slice(0, 8000),
      model: "voyage-3",
      input_type: "document",
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage embed failed: ${res.status} ${errText}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data?.[0]?.embedding ?? null;
}
