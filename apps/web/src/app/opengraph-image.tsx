import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getMessages } from "@/lib/messages";

export const alt = "كاشف تطبيقات سلة";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Satori has no Arabic glyphs of its own, so the page font travels with the image. */
async function font(): Promise<ArrayBuffer> {
  const file = await readFile(join(process.cwd(), "src/assets/plex-arabic-600.ttf"));
  return Uint8Array.from(file).buffer;
}

/**
 * Satori shapes Arabic letters correctly but has no bidirectional layout, so words in a
 * single string come out left to right. Laying each word out in a row that runs from the
 * right puts the line back in reading order.
 */
function Line({
  text,
  size,
  color,
  top,
}: {
  text: string;
  size: number;
  color?: string;
  top?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row-reverse",
        gap: size * 0.2,
        fontSize: size,
        letterSpacing: "-0.02em",
        ...(color === undefined ? {} : { color }),
        ...(top === undefined ? {} : { marginTop: top }),
      }}
    >
      {text.split(" ").map((word) => (
        <span key={word}>{word}</span>
      ))}
    </div>
  );
}

export default async function OpengraphImage(): Promise<ImageResponse> {
  const messages = getMessages();

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-end",
        padding: "96px",
        backgroundColor: "#faf8f5",
        color: "#17171a",
        fontFamily: "Plex",
      }}
    >
      <Line text={messages.site.name} size={72} />
      <Line text={messages.site.tagline} size={36} color="#6c6a66" top={24} />
      <div
        style={{
          display: "flex",
          marginTop: 64,
          height: 8,
          width: 160,
          backgroundColor: "#12594a",
          borderRadius: 4,
        }}
      />
    </div>,
    { ...size, fonts: [{ name: "Plex", data: await font(), style: "normal", weight: 600 }] },
  );
}
