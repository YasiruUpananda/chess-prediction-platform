// src/lib/chess-api.ts

export async function fetchOpponentGames(username: string, maxGames: number = 20) {
  const url = `https://lichess.org/api/games/user/${username}?max=${maxGames}&pgnInJson=true`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/x-ndjson", // Lichess streaming format
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch games for user: ${username}`);
    }

    const data = await response.text();
    
    // Parse the Newline-Delimited JSON response from Lichess
    const games = data
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    return games;
  } catch (error) {
    console.error("Error fetching chess data:", error);
    return [];
  }
}