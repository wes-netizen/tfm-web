// pages/index.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#020617", // matches --bg-main
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "560px",
          background: "radial-gradient(circle at top left, #0f172a, #020617 65%)",
          borderRadius: "1.5rem",
          border: "1px solid #1f2937",
          padding: "3rem 2.5rem",
          textAlign: "center",
          boxShadow: "0 20px 40px rgba(0,0,0,0.55)",
        }}
      >
        {/* Logo */}
        <img
          src="/tfm_logo.png"
          alt="Today's Future Me"
          style={{
            width: "100px",
            height: "100px",
            borderRadius: "999px",
            margin: "0 auto 1.5rem",
            display: "block",
          }}
        />

        {/* Title */}
        <h1
          style={{
            fontSize: "2.1rem",
            fontWeight: 700,
            color: "#e5e7eb",
            marginBottom: "0.5rem",
            letterSpacing: "-0.5px",
          }}
        >
          Today&apos;s Future Me
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: "1rem",
            color: "#94a3b8",
            marginBottom: "2.2rem",
          }}
        >
          Conscious self creation starts here.
        </p>

        {/* Begin Here button */}
        <Link href="/today" style={{ textDecoration: "none" }}>
          <button
            type="button"
            style={{
              padding: "0.85rem 2.4rem",
              borderRadius: "999px",
              border: "none",
              backgroundColor: "#059669",
              color: "white",
              fontWeight: 600,
              fontSize: "1rem",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
            }}
          >
            Begin Here
          </button>
        </Link>
      </div>
    </div>
  );
}
