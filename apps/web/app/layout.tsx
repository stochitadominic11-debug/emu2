import "./globals.css";

export const metadata = {
  title: "Remote Play Friends",
  description: "Private remote play with library, rooms, invite links, and game streaming."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
