import { pb } from "./pocketbase";

// Saved a few at a time: quicker than one by one, without flooding the server.
const CONCURRENCY = 8;

// The same change to many records of a collection (projects, contacts,
// locations, crew), and the ones that failed with why.
export async function updateEach<T extends { id: string }>(collection: string, records: T[], body: (record: T) => Record<string, unknown>) {
  const failed: { record: T; error: unknown }[] = [];
  for (let i = 0; i < records.length; i += CONCURRENCY) {
    const chunk = records.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((record) => pb.collection(collection).update(record.id, body(record))));
    results.forEach((r, j) => r.status === "rejected" && failed.push({ record: chunk[j], error: r.reason }));
  }
  return failed;
}
