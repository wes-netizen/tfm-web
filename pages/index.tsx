import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 20, fontFamily: "system-ui" }}>
      <h1>TFM Dev</h1>
      <Link href="/api/health/">/api/health</Link> · <Link href="/today/">/today</Link>
    </main>
  );
}