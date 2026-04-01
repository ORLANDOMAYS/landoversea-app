import "./globals.css";

export const metadata = {
  title: "LandOverSea",
  description: "Global dating app — connect across borders",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
