import localFont from "next/font/local";

export const dmSans = localFont({
  display: "swap",
  src: [
    {
      path: "../assets/fonts/dm-sans-variable.ttf",
      style: "normal",
      weight: "100 1000",
    },
    {
      path: "../assets/fonts/dm-sans-italic-variable.ttf",
      style: "italic",
      weight: "100 1000",
    },
  ],
  variable: "--font-dm-sans",
});

export const outfit = localFont({
  display: "swap",
  src: "../assets/fonts/outfit-variable.ttf",
  variable: "--font-outfit",
  weight: "100 900",
});
