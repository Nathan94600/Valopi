# Valopi

- Valopi isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
- Valopi was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games.  Riot Games does not endorse or sponsor this project.

## About

Valopi is a [Node.js](https://nodejs.org/en) module for interacting with [Valorant API](https://developer.riotgames.com). The module handles rate limits and includes a caching system.

## Example usage

Install valopi :

```sh
npm install valopi
```

Get informations about the status of a region :

```ts
import Valopi from "valopi";

const valopi = new Valopi("Your RIOT_TOKEN")

valopi.getStatus("EU").then(platformData => {
  if (typeof platformData == "string") console.log(`Platform data: ${platformData}`);
  else {
    console.log(`Platform name: ${platformData.name}`)
    console.log(`Platform maintenances: ${platformData.maintenances.length}`)
    console.log(`Platform incidents: ${platformData.incidents.length}`)
  }
})
```

Get match ids of recent matches on console :

```ts
import Valopi, { ConsoleQueues } from "valopi";

const valopi = new Valopi("Your RIOT_TOKEN");

valopi.getRecentMatches(ConsoleQueues.Unrated, "EU (Console)").then(recentMatches => {
  if (typeof recentMatches == "string") console.log(`Recent matches: ${recentMatches}`);
  else {
    console.log("Match ids :");

    recentMatches.matches.forEach(match => console.log(`- ${match.matchId}`));
  };
});
```

Get player names from leaderboard :

```ts
import Valopi from "valopi";

const valopi = new Valopi("Your RIOT_TOKEN");

valopi.getLeaderboard("ACT_ID", "EU", { size: 100 }).then(leaderboard => {
  if (typeof leaderboard == "string") console.log(`Leaderboard: ${leaderboard}`);
  else {
    console.log("Player names :");

    leaderboard.players.forEach(player => console.log(`- ${"gameName" in player ? player.gameName : "Anonymous"}`));
  };
});
```