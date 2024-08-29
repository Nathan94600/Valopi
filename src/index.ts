// Constants

const BASE_URL = ".api.riotgames.com/val/", TTL = 300000 /* 5 minutes */

// Functions

function updateRateLimit<RL extends RateLimits[Region | ConsoleRegion]>(rateLimit: RL, funcName: Exclude<keyof RL, "app">, headers: Headers) {
	const funcRateLimit: any = rateLimit[funcName],
	[firstAppRateLimit, firstAppRateLimitTime, secondAppRateLimit, secondAppRateLimitTime] = headers.get("x-app-rate-limit")?.split("").flatMap(v => v.split("")) || [],
	[firstAppRateCount, firstAppRateCountTime, secondAppRateCount, secondAppRateCountTime] = headers.get("x-app-rate-count")?.split("").flatMap(v => v.split("")) || [],
	[methodRateLimit, methodRateLimitTime] = headers.get("x-method-rate-limit")?.split("") || [],
	[methodRateCount, methodRateCountTime] = headers.get("x-method-rate-limit-count")?.split("") || [],
	firstAppTime = (firstAppRateCountTime || firstAppRateLimitTime),
	secondAppTime = (secondAppRateCountTime || secondAppRateLimitTime),
	methodTime = (methodRateCountTime || methodRateLimitTime);

	if (firstAppRateCount) rateLimit.app[0].count = parseInt(firstAppRateCount);
	if (secondAppRateCount) rateLimit.app[1].count = parseInt(secondAppRateCount);
	if (methodRateCount) funcRateLimit.count = parseInt(methodRateCount);

	if (firstAppRateLimit) rateLimit.app[0].max = parseInt(firstAppRateLimit);
	if (secondAppRateLimit) rateLimit.app[1].max = parseInt(secondAppRateLimit);
	if (methodRateLimit) funcRateLimit.max = parseInt(methodRateLimit);

	if (!rateLimit.app[0].timeout && firstAppTime) rateLimit.app[0].timeout = setTimeout(() => {
		rateLimit.app[0].count = 0;
		rateLimit.app[0].timeout = null;
	}, parseInt(firstAppTime) * 1000)
	if (!rateLimit.app[1].timeout && secondAppTime) rateLimit.app[1].timeout = setTimeout(() => {
		rateLimit.app[1].count = 0;
		rateLimit.app[1].timeout = null;
	}, parseInt(secondAppTime) * 1000)
	if (!funcRateLimit.timeout && methodTime) funcRateLimit.timeout = setTimeout(() => {
		funcRateLimit.count = 0;
		funcRateLimit.timeout = null;
	}, parseInt(methodTime) * 1000)
}

function isConsolRegion(region: string): region is ConsoleRegion { return region.includes("Console") }
function isConsoleQueue(queue: string): queue is ConsoleQueues { return queue.startsWith("console") }
function isPlatformType(platform: string): platform is PlatformTypes { return platform == "playstation" || platform == "xbox" }

/**
 * @param riotToken See https://developer.riotgames.com/
 */

function getMatch(cache: Cache, rateLimits: RateLimits, matchId: string, region: Region | ConsoleRegion, riotToken: string): Promise<Match | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.match[region][matchId];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + TTL <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getMatch.count >= rateLimit.getMatch.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}match${region.includes("Console") ? "/console" : ""}/v1/matches/${matchId}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getMatch", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getMatch(cache, rateLimits, matchId, region, riotToken)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					if (Array.isArray(json) || typeof json !== "object" || typeof json === null) reject({ reason: "Bad response type", value: json });
					else {
						const match: Match = {
							matchInfo: {
								customGameName: json.matchInfo.customGameName,
								gameLengthMillis: json.matchInfo.gameLengthMillis,
								gameMode: json.matchInfo.gameMode,
								gameStartMillis: json.matchInfo.gameStartMillis,
								isCompleted: json.matchInfo.isCompleted,
								isRanked: json.matchInfo.isRanked,
								mapId: json.matchInfo.mapId,
								matchId: json.matchInfo.matchId,
								provisioningFlowId: json.matchInfo.provisioningFlowId,
								queueId: json.matchInfo.queueId,
								seasonId: json.matchInfo.seasonId,
							},
							coaches: json.coaches.map((coach: ApiCoach) => new Coach(coach, cache, rateLimits, riotToken)),
							players: json.players.map((player: ApiMatchPlayer) => new MatchPlayer(player, cache, rateLimits, riotToken)),
							roundResults: json.roundResults.map((roundResult: ApiRoundResult) => new RoundResult(roundResult, cache, rateLimits, riotToken)),
							teams: json.teams.map((team: ApiTeam) => team.teamId == "Red" || team.teamId == "Blue" ? new DeathmatchTeam(team) : new NonDeathmatchTeam(team, cache, rateLimits, riotToken)),
						};
	
						cache.match[region][matchId] = { ...match, lastUpdate: Date.now() };
	
						resolve(match);
					}

					cache.match[region][matchId] = { ...json, lastUpdate: Date.now() };

					resolve(json);
				} else reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
}

/**
 * Get recent matches
 * 
 * Returns a list of match ids that have completed in the last 10 minutes for live regions and 12 hours for the esports routing value.
 * NA/LATAM/BR share a match history deployment.
 * As such, recent matches will return a combined list of matches from those three regions.
 * Requests are load balanced so you may see some inconsistencies as matches are added/removed from the list.
 * @param riotToken See https://developer.riotgames.com/
 */
function getRecentMatches(cache: Cache, rateLimits: RateLimits, queue: Queues, region: Region, riotToken: string): Promise<RecentMatches | string>
function getRecentMatches(cache: Cache, rateLimits: RateLimits, queue: ConsoleQueues, region: ConsoleRegion, riotToken: string): Promise<RecentMatches | string>
function getRecentMatches(cache: Cache, rateLimits: RateLimits, queue: Queues | ConsoleQueues, region: Region | ConsoleRegion, riotToken: string): Promise<RecentMatches | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.recentMatches[region][queue];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + TTL <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getRecentMatches.count >= rateLimit.getRecentMatches.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}match${isConsoleQueue(queue) ? "/console" : ""}/v1/recent-matches/by-queue/${queue}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getRecentMatches", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => {
				if (isConsoleQueue(queue) && isConsolRegion(region)) resolve(await getRecentMatches(cache, rateLimits, queue, region, riotToken));
				else if (!isConsoleQueue(queue) && !isConsolRegion(region)) resolve(await getRecentMatches(cache, rateLimits, queue, region, riotToken)); 
				else reject("Queue and region incompatible");
			}, parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					if (Array.isArray(json) || typeof json !== "object" || typeof json === null) reject({ reason: "Bad response type", value: json });
					else {
						const recentMatches: RecentMatches = { currentTime: json.currentTime, matches: json.matchIds.map((id: string) => new RecentMatch(id, cache, rateLimits, region, riotToken)) };
	
						cache.recentMatches[region][queue] = { ...recentMatches, lastUpdate: Date.now() };
	
						resolve(recentMatches);
					}
				} reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
}

/**
 * Get matchlist for games played by puuid 
 * @param riotToken See https://developer.riotgames.com/
 */
function getPlayerMatches(cache: Cache, rateLimits: RateLimits, puuid: Puuid, region: Region, riotToken: string): Promise<MatchList | string>
function getPlayerMatches(cache: Cache, rateLimits: RateLimits, puuid: Puuid, region: ConsoleRegion, platform: PlatformTypes, riotToken: string): Promise<MatchList | string>
function getPlayerMatches(cache: Cache, rateLimits: RateLimits, puuid: Puuid, region: Region | ConsoleRegion, platform: PlatformTypes | string, riotToken?: string): Promise<MatchList | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], isPlatform = isPlatformType(platform), cacheValue = cache.playerMatches[region][isPlatform ? platform : "_"][puuid];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + TTL <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getPlayerMatches.count >= rateLimit.getPlayerMatches.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}match${riotToken ? "/console" : ""}/v1/matchlists/by-puuid/${puuid}`, { method: "GET", headers: { "X-Riot-Token": riotToken || platform } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getPlayerMatches", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => {
				if (riotToken && isConsolRegion(region) && isPlatform) resolve(await getPlayerMatches(cache, rateLimits, puuid, region, platform, riotToken));
				else if (!isConsolRegion(region)) resolve(await getPlayerMatches(cache, rateLimits, puuid, region, platform));
				else reject("Platform and region incompatible");
			}, parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					if (Array.isArray(json) || typeof json !== "object" || typeof json === null) reject({ reason: "Bad response type", value: json });
					else {
						const matchList = {
							history: json.history.map((entry: ApiMatchListEntry) => new MatchListEntry({ gameStartTimeMillis: entry.gameStartTimeMillis, matchId: entry.matchId, queueId: entry.queueId }, cache, rateLimits, region, riotToken || platform)),
							puuid: json.puuid
						};

						cache.playerMatches[region][isPlatform ? platform : "_"][puuid] = { ...matchList, lastUpdate: Date.now() };
	
						resolve(matchList);
					}
				} else reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
}

/**
 * Get leaderboard for the competitive queue
 * @param actId Act ids can be found using the val-content API.
 * @param riotToken See https://developer.riotgames.com/
 */
function getLeaderboard(cache: Cache, rateLimits: RateLimits, actId: string, region: Exclude<Region, "ESPORTS">, riotToken: string, options: LeaderboardOptions): Promise<Leaderboard | string>
function getLeaderboard(cache: Cache, rateLimits: RateLimits, actId: string, region: ConsoleRegion, platform: PlatformTypes, riotToken: string, options: LeaderboardOptions): Promise<Leaderboard | string>
function getLeaderboard(cache: Cache, rateLimits: RateLimits, actId: string, region: Exclude<Region, "ESPORTS"> | ConsoleRegion, platform: PlatformTypes | string, riotToken: string | LeaderboardOptions, options?: LeaderboardOptions): Promise<Leaderboard | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], isPlatform = isPlatformType(platform), cacheValue = cache.leaderboard[region][isPlatform ? platform : "_"][actId], token = typeof riotToken == "string" ? riotToken : platform;

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + TTL <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getLeaderboard.count >= rateLimit.getLeaderboard.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}${options ? "console/" : ""}ranked/v1/leaderboards/by-act/${actId}${options ? `?${Object.entries(options).map(([key, val]) => `${key}=${val}`).join("&")}` : ""}`, {
			method: "GET", headers: { "X-Riot-Token": token }
		}).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getLeaderboard", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => {
				if (isConsolRegion(region) && isPlatform && typeof riotToken == "string" && options) resolve(await getLeaderboard(cache, rateLimits, actId, region, platform, riotToken, options));
				else if (!isConsolRegion(region) && typeof riotToken != "string") resolve(await getLeaderboard(cache, rateLimits, actId, region, platform, riotToken));
				else reject("Platform and region incompatible");
			}, parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					if (Array.isArray(json) || typeof json !== "object" || typeof json === null) reject({ reason: "Bad response type", value: json });
					else {
						const leaderboard = {
							actId: json.actId,
							players: json.players.map((player: ApiPlayer | ApiAnonymousPlayer) => {
								const res: Player | AnonymousPlayer = "gameName" in player && "puuid" in player && "taghLine" in player ? new Player({
									leaderboardRank: player.leaderboardRank,
									numberOfWins: player.numberOfWins,
									rankedRating: player.rankedRating,
									gameName: player.gameName,
									puuid: player.puuid,
									tagLine: player.tagLine,
								}, cache, rateLimits, token) : new AnonymousPlayer({ leaderboardRank: player.leaderboardRank, numberOfWins: player.numberOfWins, rankedRating: player.rankedRating });

								return res
							}),
							shard: json.shard,
							totalPlayers: json.totalPlayers,
						};

						cache.leaderboard[region][isPlatform ? platform : "_"][actId] = { ...leaderboard, lastUpdate: Date.now() };

						resolve(leaderboard);
					}
				} else reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
};

/**
 * Get VALORANT status for the given platform
 */
function getStatus(cache: Cache, rateLimits: RateLimits, region: Exclude<Region, "ESPORTS">, riotToken: string): Promise<PlatformData | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.status[region];
		
		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + TTL <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getStatus.count >= rateLimit.getStatus.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}status/v1/platform-data`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getStatus", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getStatus(cache, rateLimits, region, riotToken)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					if (Array.isArray(json) || typeof json !== "object" || typeof json === null) reject({ reason: "Bad response type", value: json });
					else {
						const status = {
							id: json.id,
							incidents: json.incidents.map((incident: ApiStatus) => ({
								archiveAt: incident.archive_at,
								createdAt: incident.created_at,
								id: incident.id,
								incidentSeverity: incident.incident_severity,
								maintenanceStatus: incident.maintenance_status,
								platforms: incident.platforms,
								titles: incident.titles.map(title => ({ content: title.content, locale: title.locale })),
								updatedAt: incident.updated_at,
								updates: incident.updates.map(update => ({
									author: update.author,
									createdAt: update.created_at,
									id: update.id,
									publish: update.publish,
									publishLocations: update.publish_locations,
									translations: update.translations.map(title => ({ content: title.content, locale: title.locale })),
									updatedAt: update.updated_at,
								})),
							})),
							locales: json.locales,
							maintenances: json.maintenances.map((maintenance: ApiStatus) => ({
								archiveAt: maintenance.archive_at,
								createdAt: maintenance.created_at,
								id: maintenance.id,
								incidentSeverity: maintenance.incident_severity,
								maintenanceStatus: maintenance.maintenance_status,
								platforms: maintenance.platforms,
								titles: maintenance.titles.map(title => ({ content: title.content, locale: title.locale })),
								updatedAt: maintenance.updated_at,
								updates: maintenance.updates.map(update => ({
									author: update.author,
									createdAt: update.created_at,
									id: update.id,
									publish: update.publish,
									publishLocations: update.publish_locations,
									translations: update.translations.map(title => ({ content: title.content, locale: title.locale })),
									updatedAt: update.updated_at,
								})),
							})),
							name: json.name
						};
	
						cache.status[region] = { ...status, lastUpdate: Date.now() };
	
						resolve(status);
					}
				} else reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
};

/**
 * Get leaderboard for the competitive queue
 * 
 * If you set the region to `"ESPORTS"`, the region used for acts will be `"NA"`
 * @param actId Act ids can be found using the val-content API.
 * @param riotToken See https://developer.riotgames.com/
 */
function getContent(cache: Cache, rateLimits: RateLimits, region: Region, riotToken: string, locale?: keyof LocalizedNames): Promise<Content<boolean> | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.content[region][locale || "all"];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + TTL <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getContent.count >= rateLimit.getContent.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}content/v1/contents${locale ? `?locale=${locale}`: ""}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getContent", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getContent(cache, rateLimits, region, riotToken, locale)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					if (Array.isArray(json) || typeof json !== "object" || typeof json === null) reject({ reason: "Bad response type", value: json });
					else {
						const content = {
							acts: json.acts.map((act: ApiAct) => new (act.localizedNames ? ActWithLocalizedNames : Act)(act, cache, rateLimits, riotToken)),
							characters: json.characters.map((character: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: character.assetName, id: character.id, name: character.name };
	
								if (character.localizedNames) res.localizedNames = character.localizedNames;
	
								return res;
							}),
							charms: json.charms.map((charm: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: charm.assetName, id: charm.id, name: charm.name };
	
								if (charm.localizedNames) res.localizedNames = charm.localizedNames;
	
								return res;
							}),
							charmsLevel: json.charms.map((charmLevel: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: charmLevel.assetName, id: charmLevel.id, name: charmLevel.name };
	
								if (charmLevel.localizedNames) res.localizedNames = charmLevel.localizedNames;
	
								return res;
							}),
							chromas: json.charms.map((chroma: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: chroma.assetName, id: chroma.id, name: chroma.name };
	
								if (chroma.localizedNames) res.localizedNames = chroma.localizedNames;
	
								return res;
							}),
							equips: json.charms.map((equip: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: equip.assetName, id: equip.id, name: equip.name };
	
								if (equip.localizedNames) res.localizedNames = equip.localizedNames;
	
								return res;
							}),
							playerCards: json.charms.map((playerCard: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: playerCard.assetName, id: playerCard.id, name: playerCard.name };
	
								if (playerCard.localizedNames) res.localizedNames = playerCard.localizedNames;
	
								return res;
							}),
							playerTitles: json.charms.map((playerTitle: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: playerTitle.assetName, id: playerTitle.id, name: playerTitle.name };
	
								if (playerTitle.localizedNames) res.localizedNames = playerTitle.localizedNames;
	
								return res;
							}),
							skinLevels: json.charms.map((skinLevel: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: skinLevel.assetName, id: skinLevel.id, name: skinLevel.name };
	
								if (skinLevel.localizedNames) res.localizedNames = skinLevel.localizedNames;
	
								return res;
							}),
							skins: json.charms.map((skin: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: skin.assetName, id: skin.id, name: skin.name };
	
								if (skin.localizedNames) res.localizedNames = skin.localizedNames;
	
								return res;
							}),
							sprayLevels: json.charms.map((sprayLevel: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: sprayLevel.assetName, id: sprayLevel.id, name: sprayLevel.name };
	
								if (sprayLevel.localizedNames) res.localizedNames = sprayLevel.localizedNames;
	
								return res;
							}),
							sprays: json.charms.map((spray: ContentItem) => {
								const res: Omit<ContentItem, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: spray.assetName, id: spray.id, name: spray.name };
	
								if (spray.localizedNames) res.localizedNames = spray.localizedNames;
	
								return res;
							}),
							version: json.version,
							gameModes: json.gameModes.map((gameMode: ContentItemWithAssetPath) => {
								const res: Omit<ContentItemWithAssetPath, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: gameMode.assetName, id: gameMode.id, name: gameMode.name, assetPath: gameMode.assetPath };
	
								if (gameMode.localizedNames) res.localizedNames = gameMode.localizedNames;
	
								return res;
							}),
							maps: json.maps.map((map: ContentItemWithAssetPath) => {
								const res: Omit<ContentItemWithAssetPath, "localizedNames"> & { localizedNames?: LocalizedNames } = { assetName: map.assetName, id: map.id, name: map.name, assetPath: map.assetPath };
	
								if (map.localizedNames) res.localizedNames = map.localizedNames;
	
								return res;
							})
						};

						const regionInCache = locale ? cache.content[region] : undefined;
	
						if (regionInCache) regionInCache[locale || "all"] = { ...content, lastUpdate: Date.now() };
	
						resolve(content);
					}
				} else reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
};

// Classes

export default class Valopi {
	/**
	 * @param riotToken See https://developer.riotgames.com/
	 * @param defaultRegion Includes all regions except "ESPORTS"
	 */
	constructor(riotToken: string) {
		this.riotToken = riotToken

		this.rateLimits = {
			"AP (Console)": {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null }
			},
			"EU (Console)": {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null }
			},
			"NA (Console)": {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null }
			},
			AP: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null }
			},
			BR: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null }
			},
			ESPORTS: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getContent: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null }
			},
			EU: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null }
			},
			KR: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null }
			},
			LATAM: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null }
			},
			NA: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null }
			}
		}

		this.cache = {
			content: {
				AP: {
					"all": null,
					"ar-AE": null,
					"de-DE": null,
					"en-GB": null,
					"en-US": null,
					"es-ES": null,
					"es-MX": null,
					"fr-FR": null,
					"id-ID": null,
					"it-IT": null,
					"ja-JP": null,
					"ko-KR": null,
					"pl-PL": null,
					"pt-BR": null,
					"ru-RU": null,
					"th-TH": null,
					"tr-TR": null,
					"vi-VN": null,
					"zh-CN": null,
					"zh-TW": null,
				},
				BR: {
					"all": null,
					"ar-AE": null,
					"de-DE": null,
					"en-GB": null,
					"en-US": null,
					"es-ES": null,
					"es-MX": null,
					"fr-FR": null,
					"id-ID": null,
					"it-IT": null,
					"ja-JP": null,
					"ko-KR": null,
					"pl-PL": null,
					"pt-BR": null,
					"ru-RU": null,
					"th-TH": null,
					"tr-TR": null,
					"vi-VN": null,
					"zh-CN": null,
					"zh-TW": null,
				},
				ESPORTS: {
					"all": null,
					"ar-AE": null,
					"de-DE": null,
					"en-GB": null,
					"en-US": null,
					"es-ES": null,
					"es-MX": null,
					"fr-FR": null,
					"id-ID": null,
					"it-IT": null,
					"ja-JP": null,
					"ko-KR": null,
					"pl-PL": null,
					"pt-BR": null,
					"ru-RU": null,
					"th-TH": null,
					"tr-TR": null,
					"vi-VN": null,
					"zh-CN": null,
					"zh-TW": null,
				},
				EU: {
					"all": null,
					"ar-AE": null,
					"de-DE": null,
					"en-GB": null,
					"en-US": null,
					"es-ES": null,
					"es-MX": null,
					"fr-FR": null,
					"id-ID": null,
					"it-IT": null,
					"ja-JP": null,
					"ko-KR": null,
					"pl-PL": null,
					"pt-BR": null,
					"ru-RU": null,
					"th-TH": null,
					"tr-TR": null,
					"vi-VN": null,
					"zh-CN": null,
					"zh-TW": null,
				},
				KR: {
					"all": null,
					"ar-AE": null,
					"de-DE": null,
					"en-GB": null,
					"en-US": null,
					"es-ES": null,
					"es-MX": null,
					"fr-FR": null,
					"id-ID": null,
					"it-IT": null,
					"ja-JP": null,
					"ko-KR": null,
					"pl-PL": null,
					"pt-BR": null,
					"ru-RU": null,
					"th-TH": null,
					"tr-TR": null,
					"vi-VN": null,
					"zh-CN": null,
					"zh-TW": null,
				},
				LATAM: {
					"all": null,
					"ar-AE": null,
					"de-DE": null,
					"en-GB": null,
					"en-US": null,
					"es-ES": null,
					"es-MX": null,
					"fr-FR": null,
					"id-ID": null,
					"it-IT": null,
					"ja-JP": null,
					"ko-KR": null,
					"pl-PL": null,
					"pt-BR": null,
					"ru-RU": null,
					"th-TH": null,
					"tr-TR": null,
					"vi-VN": null,
					"zh-CN": null,
					"zh-TW": null,
				},
				NA: {
					"all": null,
					"ar-AE": null,
					"de-DE": null,
					"en-GB": null,
					"en-US": null,
					"es-ES": null,
					"es-MX": null,
					"fr-FR": null,
					"id-ID": null,
					"it-IT": null,
					"ja-JP": null,
					"ko-KR": null,
					"pl-PL": null,
					"pt-BR": null,
					"ru-RU": null,
					"th-TH": null,
					"tr-TR": null,
					"vi-VN": null,
					"zh-CN": null,
					"zh-TW": null,
				}
			},
			leaderboard: {
				AP: { _: {}, playstation: {}, xbox: {} },
				BR: { _: {}, playstation: {}, xbox: {} },
				EU: { _: {}, playstation: {}, xbox: {} },
				KR: { _: {}, playstation: {}, xbox: {} },
				LATAM: { _: {}, playstation: {}, xbox: {} },
				NA: { _: {}, playstation: {}, xbox: {} },
				"AP (Console)": { _: {}, playstation: {}, xbox: {} },
				"EU (Console)": { _: {}, playstation: {}, xbox: {} },
				"NA (Console)": { _: {}, playstation: {}, xbox: {} }
			},
			match: { AP: {}, BR: {}, EU: {}, KR: {}, LATAM: {}, NA: {}, ESPORTS: {}, "AP (Console)": {}, "EU (Console)": {}, "NA (Console)": {} },
			playerMatches: {
				AP: { _: {}, playstation: {}, xbox: {} },
				BR: { _: {}, playstation: {}, xbox: {} },
				EU: { _: {}, playstation: {}, xbox: {} },
				KR: { _: {}, playstation: {}, xbox: {} },
				LATAM: { _: {}, playstation: {}, xbox: {} },
				NA: { _: {}, playstation: {}, xbox: {} },
				ESPORTS: { _: {}, playstation: {}, xbox: {} },
				"AP (Console)": { _: {}, playstation: {}, xbox: {} },
				"EU (Console)": { _: {}, playstation: {}, xbox: {} },
				"NA (Console)": { _: {}, playstation: {}, xbox: {} }
			},
			recentMatches: { AP: {}, BR: {}, EU: {}, KR: {}, LATAM: {}, NA: {}, ESPORTS: {}, "AP (Console)": {}, "EU (Console)": {}, "NA (Console)": {} },
			status: { AP: null, BR: null, EU: null, KR: null, LATAM: null, NA: null }
		}
	}

	private readonly riotToken: string;
	private readonly rateLimits: RateLimits
	private readonly cache: Cache;

	/**
	 * Get content optionally filtered by locale
	 * 
	 * If you set the region to `"ESPORTS"`, the region used for acts will be `"NA"`
	 */
	getContent(region: Region): Promise<Content<false> | string>;
	getContent(region: Region, locale: keyof LocalizedNames): Promise<Content<true> | string>;
	getContent(region: Region, locale?: keyof LocalizedNames): Promise<Content<boolean> | string> { return getContent(this.cache, this.rateLimits, region, this.riotToken, locale) };

	/**
	 * Get VALORANT status for the given platform
	 */
	getStatus(region: Exclude<Region, "ESPORTS">) { return getStatus(this.cache, this.rateLimits, region, this.riotToken) };

	/**
	 * Get leaderboard for the competitive queue
	 * @param actId Act ids can be found using the val-content API.
	 */
	getLeaderboard(actId: string, region: Exclude<Region, "ESPORTS">, options: LeaderboardOptions): Promise<Leaderboard | string>
	getLeaderboard(actId: string, region: ConsoleRegion, platformType: PlatformTypes, options: LeaderboardOptions): Promise<Leaderboard | string>
	getLeaderboard(actId: string, region: Exclude<Region, "ESPORTS"> | ConsoleRegion, platform: PlatformTypes | LeaderboardOptions, options?: LeaderboardOptions): Promise<Leaderboard | string> {
		if (isConsolRegion(region) && typeof platform == "string" && isPlatformType(platform) && options) return getLeaderboard(this.cache, this.rateLimits, actId, region, platform, this.riotToken, options);
		else if (!isConsolRegion(region) && typeof platform != "string") return getLeaderboard(this.cache, this.rateLimits, actId, region, this.riotToken, platform);
		else return new Promise((_resolve, reject) => reject("Platform and region incompatible"));
	};

	/**
	 * Get matchlist for games played by puuid 
	 */
	getPlayerMatches(puuid: Puuid, region: Region): Promise<MatchList | string>
	getPlayerMatches(puuid: Puuid, region: ConsoleRegion, platform?: PlatformTypes): Promise<MatchList | string>
	getPlayerMatches(puuid: Puuid, region: Region | ConsoleRegion, platform?: PlatformTypes): Promise<MatchList | string> {
		if (platform && isConsolRegion(region)) return getPlayerMatches(this.cache, this.rateLimits, puuid, region, platform, this.riotToken);
		else if (!isConsolRegion(region)) return getPlayerMatches(this.cache, this.rateLimits, puuid, region, this.riotToken);
		else return new Promise((_resolve, reject) => reject("Platform and region incompatible"));
	};

	/**
	 * Get match by id
	 */
	getMatch(matchId: string, region: Region | ConsoleRegion) { return getMatch(this.cache, this.rateLimits, matchId, region, this.riotToken) };

	/**
   * Get recent matches
   * 
   * Returns a list of match ids that have completed in the last 10 minutes for live regions and 12 hours for the esports routing value.
   * NA/LATAM/BR share a match history deployment.
   * As such, recent matches will return a combined list of matches from those three regions.
   * Requests are load balanced so you may see some inconsistencies as matches are added/removed from the list.
	 */
	getRecentMatches(queue: Queues, region: Region): Promise<RecentMatches | string>
	getRecentMatches(queue: ConsoleQueues, region: ConsoleRegion): Promise<RecentMatches | string>
	getRecentMatches(queue: Queues | ConsoleQueues, region: Region | ConsoleRegion): Promise<RecentMatches | string> {
		if (isConsolRegion(region) && isConsoleQueue(queue)) return getRecentMatches(this.cache, this.rateLimits, queue, region, this.riotToken);
		else if (!isConsolRegion(region) && !isConsoleQueue(queue)) return getRecentMatches(this.cache, this.rateLimits, queue, region, this.riotToken);
		else return new Promise((_resolve, reject) => reject("Queue and region incompatible"))
	};
}

class NonDeathmatchTeam {
	constructor(team: ApiTeam, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.teamId = team.teamId;
		this.team = new PlayerInfo(team.teamId, cache, rateLimits, riotToken);
		this.won = team.won;
		this.roundsPlayed = team.roundsPlayed;
		this.roundsWon = team.roundsWon;
		this.numPoints = team.numPoints;
	}

	/**
	 * This is an arbitrary string. Red and Blue in bomb modes. The puuid of the player in deathmatch.
	 */
	readonly teamId: Puuid;
	readonly team: PlayerInfo;
	readonly won: boolean;
	readonly roundsPlayed: number;
	readonly roundsWon: number;
	/**
	 * Team points scored. Number of kills in deathmatch.
	 */
	readonly numPoints: number
}

class DeathmatchTeam {
	constructor(team: ApiTeam) {
		if (team.teamId != "Blue" || team.teamId != "Blue") throw new Error("Invalid team id");

		this.teamId = team.teamId;
		this.won = team.won;
		this.roundsPlayed = team.roundsPlayed;
		this.roundsWon = team.roundsWon;
		this.numPoints = team.numPoints;
	}

	/**
	 * This is an arbitrary string. Red and Blue in bomb modes. The puuid of the player in deathmatch.
	 */
	readonly teamId: "Red" | "Blue";
	readonly won: boolean;
	readonly roundsPlayed: number;
	readonly roundsWon: number;
	/**
	 * Team points scored. Number of kills in deathmatch.
	 */
	readonly numPoints: number
}

class Coach {
	constructor(coach: ApiCoach, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.player = new PlayerInfo(coach.puuid, cache, rateLimits, riotToken);
		this.teamId = coach.teamId;
	}

	readonly player: PlayerInfo;
	readonly teamId: string;
}

class PlayerLocations {
	constructor(playerLocations: ApiPlayerLocations, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.player = new PlayerInfo(playerLocations.puuid, cache, rateLimits, riotToken);
		this.viewRadians = playerLocations.viewRadians;
		this.location = playerLocations.location;
	}

	readonly player: PlayerInfo;
	readonly viewRadians: number;
	readonly location: Location;
}

class Damage {
	constructor(damage: ApiDamage, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.receiver = new PlayerInfo(damage.receiver, cache, rateLimits, riotToken);
		this.damage = damage.damage;
		this.legshots = damage.legshots;
		this.bodyshots = damage.bodyshots;
		this.headshots = damage.headshots;
	}

	readonly receiver: PlayerInfo;
	readonly damage: number;
	readonly legshots: number;
	readonly bodyshots: number;
	readonly headshots: number;
}

class PlayerRoundStats {
	constructor(playerRoundStats: ApiPlayerRoundStats, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.player = new PlayerInfo(playerRoundStats.puuid, cache, rateLimits, riotToken);
		this.kills = playerRoundStats.kills.map(kill => new Kill(kill, cache, rateLimits, riotToken));
		this.damage = playerRoundStats.damage.map(damage => new Damage(damage, cache, rateLimits, riotToken));
		this.score = playerRoundStats.score;
		this.economy = {
			armor: playerRoundStats.economy.armor,
			loadoutValue: playerRoundStats.economy.loadoutValue,
			remaining: playerRoundStats.economy.remaining,
			spent: playerRoundStats.economy.spent,
			weapon: playerRoundStats.economy.weapon,
		};
		this.ability = {
			ability1Effects: playerRoundStats.ability.ability1Effects,
			ability2Effects: playerRoundStats.ability.ability2Effects,
			grenadeEffects: playerRoundStats.ability.grenadeEffects,
			ultimateEffects: playerRoundStats.ability.ultimateEffects,
		};
	}

	readonly player: PlayerInfo;
	readonly kills: Kill[];
	readonly damage: Damage[];
	readonly score: number;
	readonly economy: Economy;
	readonly ability: Ability;
}

class PlayerInfo {
	constructor(puuid: Puuid, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.puuid = puuid

		this.cache = cache;
		this.rateLimits = rateLimits;
		this.riotToken = riotToken;
	}

	/**
	 * PUUID
	 */
	readonly puuid: Puuid;

	private readonly riotToken: string;
	private readonly rateLimits: RateLimits
	private readonly cache: Cache;

	matches(region: Region): Promise<MatchList | string>
	matches(region: ConsoleRegion, platform: PlatformTypes): Promise<MatchList | string>
	matches(region: Region | ConsoleRegion, platform?: PlatformTypes): Promise<MatchList | string> {
		if (platform && isConsolRegion(region)) return getPlayerMatches(this.cache, this.rateLimits, this.puuid, region, platform, this.riotToken);
		else if (!isConsolRegion(region)) return getPlayerMatches(this.cache, this.rateLimits, this.puuid, region, this.riotToken);
		else return new Promise((_resolve, reject) => reject("Platform and region incompatible"));
	};
}

class Kill {
	constructor(kill: ApiKill, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.timeSinceGameStartMillis = kill.timeSinceGameStartMillis;
		this.timeSinceRoundStartMillis = kill.timeSinceRoundStartMillis;
		this.killer = new PlayerInfo(kill.killer, cache, rateLimits, riotToken);
		this.victim = new PlayerInfo(kill.victim, cache, rateLimits, riotToken);
		this.victimLocation = {
			x: kill.victimLocation.x,
			y: kill.victimLocation.y,
		};
		this.assistants = kill.assistants.map(assistant => new PlayerInfo(assistant, cache, rateLimits, riotToken));
		this.playerLocations = kill.playerLocations.map(playerLocation => new PlayerLocations(playerLocation, cache, rateLimits, riotToken));
		this.finishingDamage = {
			damageItem: kill.finishingDamage.damageItem,
			damageType: kill.finishingDamage.damageType,
			isSecondaryFireMode: kill.finishingDamage.isSecondaryFireMode,
		};
	}

	readonly timeSinceGameStartMillis: number;
	readonly timeSinceRoundStartMillis: number;
	readonly killer: PlayerInfo;
	readonly victim: PlayerInfo;
	readonly victimLocation: Location;
	readonly assistants: PlayerInfo[];
	readonly playerLocations: PlayerLocations[];
	readonly finishingDamage: FinishingDamage;
}

class RoundResult {
	constructor(roundResult: ApiRoundResult, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.roundNum = roundResult.roundNum;
		this.roundResult = roundResult.roundResult;
		this.roundCeremony = roundResult.roundCeremony;
		this.winningTeam = roundResult.winningTeam;
		this.bombPlanter = new PlayerInfo(roundResult.bombPlanter, cache, rateLimits, riotToken);
		this.bombDefuser = new PlayerInfo(roundResult.bombDefuser, cache, rateLimits, riotToken);
		this.plantRoundTime = roundResult.plantRoundTime;
		this.plantPlayerLocations = roundResult.plantPlayerLocations.map(playerLocation => new PlayerLocations(playerLocation, cache, rateLimits, riotToken));
		this.plantLocation = roundResult.plantLocation;
		this.plantSite = roundResult.plantSite;
		this.defuseRoundTime = roundResult.defuseRoundTime;
		this.defusePlayerLocations = roundResult.defusePlayerLocations.map(playerLocation => new PlayerLocations(playerLocation, cache, rateLimits, riotToken));;
		this.playerStats = roundResult.playerStats.map(playerRoundStats => new PlayerRoundStats(playerRoundStats, cache, rateLimits, riotToken));
		this.roundResultCode = roundResult.roundResultCode;
	}

	readonly roundNum: number;
	readonly roundResult: string;
	readonly roundCeremony: string;
	readonly winningTeam: string;
	readonly bombPlanter: PlayerInfo;
	readonly bombDefuser: PlayerInfo;
	readonly plantRoundTime: number;
	readonly plantPlayerLocations: PlayerLocations[];
	readonly plantLocation: Location;
	readonly plantSite: string;
	readonly defuseRoundTime: number;
	readonly defusePlayerLocations: PlayerLocations[];
	readonly playerStats: PlayerRoundStats[];
	readonly roundResultCode: string;
}

class MatchPlayer {
	constructor(player: ApiMatchPlayer, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.puuid = player.puuid;
		this.gameName = player.gameName;
		this.tagLine = player.tagLine;
		this.teamId = player.teamId;
		this.partyId = player.partyId;
		this.characterId = player.characterId;
		this.stats = {
			abilityCasts: {
				ability1Casts: player.stats.abilityCasts.ability1Casts,
				ability2Casts: player.stats.abilityCasts.ability2Casts,
				grenadeCasts: player.stats.abilityCasts.grenadeCasts,
				ultimateCasts: player.stats.abilityCasts.ultimateCasts,
			},
			assists: player.stats.assists,
			deaths: player.stats.deaths,
			kills: player.stats.kills,
			playtimeMillis: player.stats.playtimeMillis,
			roundsPlayed: player.stats.roundsPlayed,
			score: player.stats.score,
		};
		this.competitiveTier = player.competitiveTier;
		this.playerCard = player.playerCard;
		this.playerTitle = player.playerTitle;

		this.cache = cache;
		this.rateLimits = rateLimits;
		this.riotToken = riotToken;
	}

	readonly puuid: Puuid;
	readonly gameName: string;
	readonly tagLine: string;
	readonly teamId: string;
	readonly partyId: string;
	readonly characterId: string;
	readonly stats: PlayerStats;
	readonly competitiveTier: number;
	readonly playerCard: string;
	readonly playerTitle: string;

	private readonly riotToken: string;
	private readonly rateLimits: RateLimits
	private readonly cache: Cache;

	matches(region: Region): Promise<MatchList | string>
	matches(region: ConsoleRegion, platform: PlatformTypes): Promise<MatchList | string>
	matches(region: Region | ConsoleRegion, platform?: PlatformTypes): Promise<MatchList | string> {
		if (platform && isConsolRegion(region)) return getPlayerMatches(this.cache, this.rateLimits, this.puuid, region, platform, this.riotToken);
		else if (!isConsolRegion(region)) return getPlayerMatches(this.cache, this.rateLimits, this.puuid, region, this.riotToken);
		else return new Promise((_resolve, reject) => reject("Platform and region incompatible"));
	};
}

class RecentMatch {
	constructor(matchId: string, cache: Cache, rateLimits: RateLimits, region: Region | ConsoleRegion, riotToken: string) {
		this.matchId = matchId;

		this.cache = cache;
		this.rateLimits = rateLimits;
		this.region = region;
		this.riotToken = riotToken;
	}

	readonly matchId: string;

	private readonly riotToken: string;
	private readonly rateLimits: RateLimits
	private readonly region: Region | ConsoleRegion;
	private readonly cache: Cache;

	match() { return getMatch(this.cache, this.rateLimits, this.matchId, this.region, this.riotToken) }
}

class MatchListEntry {
	constructor(matchEntry: ApiMatchListEntry, cache: Cache, rateLimits: RateLimits, region: Region | ConsoleRegion, riotToken: string) {
		this.matchId = matchEntry.matchId;
		this.gameStartTimeMillis = matchEntry.gameStartTimeMillis;
		this.queueId = matchEntry.queueId;

		this.cache = cache;
		this.rateLimits = rateLimits;
		this.region = region;
		this.riotToken = riotToken;
	}

	readonly matchId: string;
	readonly gameStartTimeMillis: number;
	readonly queueId: string;

	private readonly riotToken: string;
	private readonly rateLimits: RateLimits
	private readonly region: Region | ConsoleRegion;
	private readonly cache: Cache;

	match() { return getMatch(this.cache, this.rateLimits, this.matchId, this.region, this.riotToken) }
}

class Act {
	constructor(act: ApiAct | Omit<ApiAct, "localizedNames">, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		this.name = act.name;
		this.id = act.id;
		this.isActive = act.isActive;

		this.cache = cache;
		this.rateLimits = rateLimits;
		this.riotToken = riotToken;
	}

	readonly name: string;
	readonly id: string;
	readonly isActive: boolean;

	private readonly riotToken: string;
	private readonly rateLimits: RateLimits
	private readonly cache: Cache;

	leaderboard(region: Exclude<Region, "ESPORTS">, options?: LeaderboardOptions) { return getLeaderboard(this.cache, this.rateLimits, this.id, region, this.riotToken, options || {}) }
}

class ActWithLocalizedNames extends Act {
	constructor(act: ApiAct | Omit<ApiAct, "localizedNames">, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		super(act, cache, rateLimits, riotToken);

		if ("localizedNames" in act) this.localizedNames = act.localizedNames;
	}

	readonly localizedNames?: LocalizedNames;
}

class AnonymousPlayer {
	constructor(player: ApiAnonymousPlayer) {
		this.leaderboardRank = player.leaderboardRank;
		this.numberOfWins = player.numberOfWins;
		this.rankedRating = player.rankedRating;
	}

	readonly leaderboardRank: number;
	readonly rankedRating: number;
	readonly numberOfWins: number;
}

class Player extends AnonymousPlayer {
	constructor(player: ApiPlayer, cache: Cache, rateLimits: RateLimits, riotToken: string) {
		super(player)

		this.gameName = player.gameName;
		this.puuid = player.puuid;
		this.tagLine = player.tagLine;

		this.cache = cache;
		this.rateLimits = rateLimits;
		this.riotToken = riotToken;
	}

	/**
	 * This field may be omitted if the player has been anonymized.
	 */
	readonly puuid: Puuid;
	/**
	 * This field may be omitted if the player has been anonymized.
	 */
	readonly gameName: string;
	/**
	 * This field may be omitted if the player has been anonymized.
	 */
	readonly tagLine: string;

	private readonly riotToken: string;
	private readonly rateLimits: RateLimits
	private readonly cache: Cache;

	matches(region: Region): Promise<MatchList | string>
	matches(region: ConsoleRegion, platform: PlatformTypes): Promise<MatchList | string>
	matches(region: Region | ConsoleRegion, platform?: PlatformTypes): Promise<MatchList | string> {
		if (platform && isConsolRegion(region)) return getPlayerMatches(this.cache, this.rateLimits, this.puuid, region, platform, this.riotToken);
		else if (!isConsolRegion(region)) return getPlayerMatches(this.cache, this.rateLimits, this.puuid, region, this.riotToken);
		else return new Promise((_resolve, reject) => reject("Platform and region incompatible"));
	};
}

// Types

export type Puuid = string;

export type Region = "AP" | "BR" | "ESPORTS" | "EU" | "KR" | "LATAM" | "NA";

export type ConsoleRegion = "AP (Console)" | "EU (Console)" | "NA (Console)";

// Interfaces

interface Cache {
	content: Record<Region, Record<keyof LocalizedNames, Content<true> & { lastUpdate: number } | null> & Record<"all", Content<false> & { lastUpdate: number } | null>>;
	status: Record<Exclude<Region, "ESPORTS">, PlatformData & { lastUpdate: number } | null>;
	leaderboard: Record<Exclude<Region, "ESPORTS"> | ConsoleRegion, Record<PlatformTypes | "_", Record<string, Leaderboard & { lastUpdate: number }>>>;
	playerMatches: Record<Region | ConsoleRegion, Record<PlatformTypes | "_", Record<Puuid, MatchList & { lastUpdate: number }>>>;
	match: Record<Region | ConsoleRegion, Record<string, Match & { lastUpdate: number }>>;	
	recentMatches: Record<Region | ConsoleRegion, Record<string, RecentMatches & { lastUpdate: number }>>;
}

interface RateLimits {
	AP: {
		app: [RateLimit, RateLimit];
		getContent: RateLimit;
		getStatus: RateLimit;
		getLeaderboard: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit;
	};
	BR: {
		app: [RateLimit, RateLimit];
		getContent: RateLimit;
		getStatus: RateLimit;
		getLeaderboard: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit;
	};
	ESPORTS: {
		app: [RateLimit, RateLimit];
		getContent: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit
	};
	EU: {
		app: [RateLimit, RateLimit];
		getContent: RateLimit;
		getStatus: RateLimit;
		getLeaderboard: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit;
	};
	KR: {
		app: [RateLimit, RateLimit];
		getContent: RateLimit;
		getStatus: RateLimit;
		getLeaderboard: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit;
	};
	LATAM: {
		app: [RateLimit, RateLimit];
		getContent: RateLimit;
		getStatus: RateLimit;
		getLeaderboard: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit;
	};
	NA: {
		app: [RateLimit, RateLimit];
		getContent: RateLimit;
		getStatus: RateLimit;
		getLeaderboard: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit;
	};
	"AP (Console)": {
		app: [RateLimit, RateLimit];
		getLeaderboard: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit;
	};
	"EU (Console)": {
		app: [RateLimit, RateLimit];
		getLeaderboard: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit;
	};
	"NA (Console)": {
		app: [RateLimit, RateLimit];
		getLeaderboard: RateLimit;
		getPlayerMatches: RateLimit;
		getRecentMatches: RateLimit;
		getMatch: RateLimit;
	};
}

export interface Content<LocaleIsSet extends boolean> {
	version: string;
	characters: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	maps: (LocaleIsSet extends true ? Omit<ContentItemWithAssetPath, "localizedNames"> : ContentItemWithAssetPath)[];
	chromas: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	skins: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	skinLevels: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	equips: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	gameModes: (LocaleIsSet extends true ? Omit<ContentItemWithAssetPath, "localizedNames"> : ContentItemWithAssetPath)[];
	sprays: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	sprayLevels: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	charms: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	charmsLevel: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	playerCards: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	playerTitles: (LocaleIsSet extends true ? Omit<ContentItem, "localizedNames"> : ContentItem)[];
	acts: (LocaleIsSet extends true ? Act : ActWithLocalizedNames)[];
}

export interface RecentMatches {
	currentTime: number;
	/**
	 * A list of recent match.
	 */
	matches: RecentMatch[];
}

export interface Match {
	matchInfo: MatchInfo;
	players: MatchPlayer[];
	coaches: Coach[];
	teams: (NonDeathmatchTeam | DeathmatchTeam)[];
	roundResults: RoundResult[];
}

export interface MatchInfo {
	matchId: string;
	mapId: string;
	gameLengthMillis: number;
	gameStartMillis: number;
	provisioningFlowId: string;
	isCompleted: boolean;
	customGameName: string;
	queueId: string;
	gameMode: string;
	isRanked: boolean;
	seasonId: string;
}

export interface MatchList {
	puuid: Puuid;
	history: MatchListEntry[];
}

export interface Leaderboard {
	/**
	 * The shard for the given leaderboard.
	 */
	shard: string;
	/**
	 * The act id for the given leaderboard. Act ids can be found using the val-content API.
	 */
	actId: string;
	/**
	 * The total number of players in the leaderboard.
	 */
	totalPlayers: number;
	players: (Player | AnonymousPlayer)[];
};

export interface RateLimit {
	count: number;
	max: number;
	timeout: NodeJS.Timeout | null;
};

export interface LeaderboardOptions {
	/**
	 * Defaults to 200. Valid values: 1 to 200.
	 */
	size?: number;
	/**
	 * Defaults to 0.
	 */
	startIndex?: number
}

export interface PlayerStats {
	score: number;
	roundsPlayed: number;
	kills: number;
	deaths: number;
	assists: number;
	playtimeMillis: number;
	abilityCasts: AbilityCasts;
}

export interface AbilityCasts {
	grenadeCasts: number;
	ability1Casts: number;
	ability2Casts: number;
	ultimateCasts: number;
}

export interface PlatformData {
	id: string;
	name: string;
	locales: string[];
	maintenances: Status[];
	incidents: Status[];
}

export interface Status {
	id: number;
	maintenanceStatus: MaintenanceStatus;
	incidentSeverity: IncidentSeverities;
	titles: StatusContent[];
	updates: Update[];
	createdAt: string;
	archiveAt: string;
	updatedAt: string;
	platforms: Platforms;
}

export interface StatusContent {
	locale: string;
	content: string;
}

export interface Update {
	id: number;
	author: string;
	publish: boolean;
	publishLocations: PublishLocations[];
	translations: StatusContent[];
	createdAt: string;
	updatedAt: string;
}

export interface LocalizedNames {
	"ar-AE": string;
	"de-DE": string;
	"en-GB": string;
	"en-US": string;
	"es-ES": string;
	"es-MX": string;
	"fr-FR": string;
	"id-ID": string;
	"it-IT": string;
	"ja-JP": string;
	"ko-KR": string;
	"pl-PL": string;
	"pt-BR": string;
	"ru-RU": string;
	"th-TH": string;
	"tr-TR": string;
	"vi-VN": string;
	"zh-CN": string;
	"zh-TW": string;
};

export interface Economy {
	loadoutValue: number;
	weapon: string;
	armor: string;
	remaining: number;
	spent: number;
}

export interface Ability {
	grenadeEffects: string;
	ability1Effects: string;
	ability2Effects: string;
	ultimateEffects: string;
}

export interface FinishingDamage {
	damageType: string;
	damageItem: string;
	isSecondaryFireMode: boolean;
}

export interface Location {
	x: number;
	y: number;
}

export interface ContentItem {
	name: string;
	/**
	 * This field is excluded from the response when a locale is set
	 */
	localizedNames: LocalizedNames;
	id: string;
	assetName: string;
};

export interface ContentItemWithAssetPath extends ContentItem {
	/**
	 * This field is only included for maps and game modes. These values are used in the match response.
	 */
	assetPath: string;
};

// API Interfaces

interface ApiAct {
	name: string;
	/**
	 * This field is excluded from the response when a locale is set
	 */
	localizedNames: LocalizedNames;
	id: string;
	isActive: boolean;
}

interface ApiRoundResult {
	roundNum: number;
	roundResult: string;
	roundCeremony: string;
	winningTeam: string;
	/**
	 * PUUID of player
	 */
	bombPlanter: Puuid;
	/**
	 * PUUID of player
	 */
	bombDefuser: Puuid;
	plantRoundTime: number;
	plantPlayerLocations: ApiPlayerLocations[];
	plantLocation: Location;
	plantSite: string;
	defuseRoundTime: number;
	defusePlayerLocations: ApiPlayerLocations[];
	playerStats: ApiPlayerRoundStats[];
	roundResultCode: string;
}

interface ApiPlayerRoundStats {
	puuid: Puuid;
	kills: ApiKill[];
	damage: ApiDamage[];
	score: number;
	economy: Economy;
	ability: Ability;
}

interface ApiDamage {
	/**
	 * PUUID
	 */
	receiver: Puuid;
	damage: number;
	legshots: number;
	bodyshots: number;
	headshots: number;
}

interface ApiKill {
	timeSinceGameStartMillis: number;
	timeSinceRoundStartMillis: number;
	/**
	 * PUUID
	 */
	killer: Puuid;
	/**
	 * PUUID
	 */
	victim: Puuid;
	victimLocation: Location;
	/**
	 * List of PUUIDs
	 */
	assistants: Puuid[];
	playerLocations: ApiPlayerLocations[];
	finishingDamage: FinishingDamage;
}

interface ApiPlayerLocations {
	puuid: Puuid;
	viewRadians: number;
	location: Location;
}

interface ApiCoach {
	puuid: Puuid;
	teamId: string;
}

interface ApiMatchPlayer {
	puuid: Puuid;
	gameName: string;
	tagLine: string;
	teamId: string;
	partyId: string;
	characterId: string;
	stats: PlayerStats;
	competitiveTier: number;
	playerCard: string;
	playerTitle: string;
}

interface ApiMatchListEntry {
	matchId: string;
	gameStartTimeMillis: number;
	queueId: string;
}

interface ApiPlayer {
	/**
	 * This field may be omitted if the player has been anonymized.
	 */
	puuid: Puuid;
	/**
	 * This field may be omitted if the player has been anonymized.
	 */
	gameName: string;
	/**
	 * This field may be omitted if the player has been anonymized.
	 */
	tagLine: string;
	leaderboardRank: number;
	rankedRating: number;
	numberOfWins: number;
}

interface ApiAnonymousPlayer {
	leaderboardRank: number;
	rankedRating: number;
	numberOfWins: number;
}

interface ApiTeam {
	/**
	 * This is an arbitrary string. Red and Blue in bomb modes. The puuid of the player in deathmatch.
	 */
	teamId: "Red" | "Blue" | Puuid;
	won: boolean;
	roundsPlayed: number;
	roundsWon: number;
	/**
	 * Team points scored. Number of kills in deathmatch.
	 */
	numPoints: number;
}

interface ApiStatus {
	id: number;
	maintenance_status: MaintenanceStatus;
	incident_severity: IncidentSeverities;
	titles: StatusContent[];
	updates: ApiUpdate[];
	created_at: string;
	archive_at: string;
	updated_at: string;
	platforms: Platforms;
}

interface ApiUpdate {
	id: number;
	author: string;
	publish: boolean;
	publish_locations: PublishLocations[];
	translations: StatusContent[];
	created_at: string;
	updated_at: string;
}

// Enums

export enum PublishLocations {
	Riotclient = "riotclient",
	Riotstatus = "riotstatus",
	Game = "game"
}

export enum MaintenanceStatus {
	Scheduled = "scheduled",
	InProgress = "in_progress",
	Complete = "complete"
}

export enum IncidentSeverities {
	Info = "info",
	Warning = "warning",
	Critical = "critical"
}

export enum Platforms {
	Windows = "windows",
	Macos = "macos",
	Android = "android",
	Ios = "ios",
	Ps4 = "ps4",
	Xbone = "xbone",
	Switch = "switch"
}

export enum PlatformTypes {
	Playstation = "playstation",
	Xbox = "xbox"
};

export enum Queues {
	Competitive = "competitive",
	Unrated = "unrated",
	Spikerush = "spikerush",
	Tournamentmode = "tournamentmode",
	Deathmatch = "deathmatch",
	Onefa = "onefa",
	Ggteam = "ggteam",
	Hurm = "hurm",
	Swiftplay = "swiftplay",
}

export enum ConsoleQueues {
	Unrated = "console_unrated",
	Deathmatch = "console_deathmatch",
	Swiftplay = "console_swiftplay",
	Hurm = "console_hurm",
}