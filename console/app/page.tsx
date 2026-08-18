import { headers } from "next/headers";
import { ConsoleApp } from "../src/console-app";
import { loadConsoleSnapshot } from "../src/data/live-console";

export const metadata = {
  title: "PAX Console",
  description: "Operations console for the PAX FDE platform.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await loadConsoleSnapshot({
    requestHeaders: await headers(),
    environment: process.env,
  });
  return <ConsoleApp snapshot={snapshot} />;
}
