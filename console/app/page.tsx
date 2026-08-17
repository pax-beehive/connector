import { ConsoleApp } from "../src/console-app";
import { prototypeRepository } from "../src/data/mock-console-repository";

export const metadata = {
  title: "PAX Console",
  description: "Operations console for the PAX FDE platform.",
};

export default async function Home() {
  const snapshot = await prototypeRepository.getSnapshot();
  return <ConsoleApp snapshot={snapshot} />;
}
