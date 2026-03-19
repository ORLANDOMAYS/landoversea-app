export const metadata = {
  title: "LandOverSea",
  description: "Global dating app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif", background: "#fafafa" }}>
        <div style={{ padding: 16, borderBottom: "1px solid #ddd", background: "#fff" }}>
          <strong>LandOverSea</strong>
        </div>
        <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>{children}</main>
      </body>
    </html>
  );
}
