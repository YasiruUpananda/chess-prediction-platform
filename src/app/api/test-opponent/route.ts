import { NextResponse } from "next/server";
import { fetchOpponentGames } from "@/lib/chess-api";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username") || "penguingim1"; // Default to a famous master account for testing

  const games = await fetchOpponentGames(username, 5);

  return NextResponse.json({
    success: true,
    targetPlayer: username,
    gamesFetched: games.length,
    sampleGame: games[0] || null,
  });
}