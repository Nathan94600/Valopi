// Constants

const BASE_URL = ".api.riotgames.com/val/"

// Functions

function updateRateLimit(rateLimit: RateLimits[Region], funcName: FunctionName, headers: Headers) {
	const [firstAppRateLimit, firstAppRateLimitTime, secondAppRateLimit, secondAppRateLimitTime] = headers.get("x-app-rate-limit")?.split("").flatMap(v => v.split("")) || [],
	[firstAppRateCount, firstAppRateCountTime, secondAppRateCount, secondAppRateCountTime] = headers.get("x-app-rate-count")?.split("").flatMap(v => v.split("")) || [],
	[methodRateLimit, methodRateLimitTime] = headers.get("x-method-rate-limit")?.split("") || [],
	[methodRateCount, methodRateCountTime] = headers.get("x-method-rate-limit-count")?.split("") || [],
	firstAppTime = (firstAppRateCountTime || firstAppRateLimitTime),
	secondAppTime = (secondAppRateCountTime || secondAppRateLimitTime),
	methodTime = (methodRateCountTime || methodRateLimitTime);

	if (firstAppRateCount) rateLimit.app[0].count = parseInt(firstAppRateCount);
	if (secondAppRateCount) rateLimit.app[1].count = parseInt(secondAppRateCount);
	if (methodRateCount) rateLimit[funcName].count = parseInt(methodRateCount);

	if (firstAppRateLimit) rateLimit.app[0].max = parseInt(firstAppRateLimit);
	if (secondAppRateLimit) rateLimit.app[1].max = parseInt(secondAppRateLimit);
	if (methodRateLimit) rateLimit[funcName].max = parseInt(methodRateLimit);

	if (!rateLimit.app[0].timeout && firstAppTime) rateLimit.app[0].timeout = setTimeout(() => {
		rateLimit.app[0].count = 0;
		rateLimit.app[0].timeout = null;
	}, parseInt(firstAppTime) * 1000)
	if (!rateLimit.app[1].timeout && secondAppTime) rateLimit.app[1].timeout = setTimeout(() => {
		rateLimit.app[1].count = 0;
		rateLimit.app[1].timeout = null;
	}, parseInt(secondAppTime) * 1000)
	if (!rateLimit[funcName].timeout && methodTime) rateLimit[funcName].timeout = setTimeout(() => {
		rateLimit[funcName].count = 0;
		rateLimit[funcName].timeout = null;
	}, parseInt(methodTime) * 1000)
}

/**
 * @param riotToken See https://developer.riotgames.com/
 */
function getMatch(cache: Cache, rateLimits: RateLimits, matchId: string, region: Region, riotToken: string): Promise<Match | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.match[region][matchId];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getMatch.count >= rateLimit.getMatch.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}match/v1/matches/${matchId}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getMatch", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getMatch(cache, rateLimits, matchId, region, riotToken)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.match[region][matchId] = { ...json, lastUpdate: Date.now() };

					resolve(json);
				} else reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
}

/**
 * @param riotToken See https://developer.riotgames.com/
 */
function getConsoleMatch(cache: Cache, rateLimits: RateLimits, matchId: string, region: ConsoleRegion, platform: PlatformTypes, riotToken: string): Promise<Match | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.consoleMatch[region][platform][matchId];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getConsoleMatch.count >= rateLimit.getConsoleMatch.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}match/v1/matches/${matchId}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getConsoleMatch", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getConsoleMatch(cache, rateLimits, matchId, region, platform, riotToken)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.consoleMatch[region][platform][matchId] = { ...json, lastUpdate: Date.now() };

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
function getRecentMatches(cache: Cache, rateLimits: RateLimits, queue: Queues, region: Region, riotToken: string): Promise<RecentMatches | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], console = queue.startsWith("console"), cacheValue = cache.recentMatches[region][queue];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getRecentMatches.count >= rateLimit.getRecentMatches.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}match${console ? "/console" : ""}/v1/recent-matches/by-queue/${queue}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getRecentMatches", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getRecentMatches(cache, rateLimits, queue, region, riotToken)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.recentMatches[region][queue] = { ...json, lastUpdate: Date.now() };

					resolve(json);
				} reject(json);
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
function getConsoleRecentMatches(cache: Cache, rateLimits: RateLimits, queue: ConsoleQueues, region: ConsoleRegion, riotToken: string): Promise<RecentMatches | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], console = queue.startsWith("console"), cacheValue = cache.consoleRecentMatches[region][queue];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getConsoleRecentMatches.count >= rateLimit.getConsoleRecentMatches.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}match${console ? "/console" : ""}/v1/recent-matches/by-queue/${queue}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getConsoleRecentMatches", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getConsoleRecentMatches(cache, rateLimits, queue, region, riotToken)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.recentMatches[region][queue] = { ...json, lastUpdate: Date.now() };

					resolve(json);
				} reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
}

/**
 * Get matchlist for games played by puuid 
 * @param riotToken See https://developer.riotgames.com/
 */
function getPlayerMatches(cache: Cache, rateLimits: RateLimits, puuid: Puuid, region: Region, riotToken: string): Promise<MatchList | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.playerMatches[region][puuid];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getPlayerMatches.count >= rateLimit.getPlayerMatches.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}match/v1/matchlists/by-puuid/${puuid}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getPlayerMatches", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getPlayerMatches(cache, rateLimits, puuid, region, riotToken)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.playerMatches[region][puuid] = { ...json, lastUpdate: Date.now() };

					resolve(json);
				} else reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
}

/**
 * Get matchlist for games played by puuid 
 * @param riotToken See https://developer.riotgames.com/
 */
function getConsolePlayerMatches(cache: Cache, rateLimits: RateLimits, puuid: Puuid, region: ConsoleRegion, platform: PlatformTypes, riotToken: string): Promise<MatchList | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.consolePlayerMatches[region][platform][puuid];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getConsolePlayerMatches.count >= rateLimit.getConsolePlayerMatches.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}match/console/v1/matchlists/by-puuid/${puuid}?platformType=${platform}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getConsolePlayerMatches", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getConsolePlayerMatches(cache, rateLimits, puuid, region, platform, riotToken)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.consolePlayerMatches[region][platform][puuid] = { ...json, lastUpdate: Date.now() };

					resolve(json);
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
function getLeaderboard(cache: Cache, rateLimits: RateLimits, actId: string, region: Exclude<Region, "ESPORTS">, riotToken: string, options: LeaderboardOptions): Promise<Leaderboard | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.leaderboard[region][actId];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getLeaderboard.count >= rateLimit.getLeaderboard.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}ranked/v1/leaderboards/by-act/${actId}${options ? `?${Object.entries(options).map(([key, val]) => `${key}=${val}`).join("&")}` : ""}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getLeaderboard", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getLeaderboard(cache, rateLimits, actId, region, riotToken, options)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.leaderboard[region][actId] = { ...json, lastUpdate: Date.now() };

					resolve(json);
				} else reject(json);
			}, () => res.text().then(text => (res.status.toString()[0] == "2" ? resolve : reject)(text)))
		}, reason => resolve(reason))
	})
};

/**
 * Get leaderboard for the competitive queue
 * @param actId Act ids can be found using the val-content API.
 * @param riotToken See https://developer.riotgames.com/
 */
function getConsoleLeaderboard(cache: Cache, rateLimits: RateLimits, actId: string, platformType: PlatformTypes, region: ConsoleRegion, riotToken: string, options: LeaderboardOptions): Promise<Leaderboard | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.consoleLeaderboard[region][platformType][actId];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getConsoleLeaderboard.count >= rateLimit.getConsoleLeaderboard.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}console/ranked/v1/leaderboards/by-act/${actId}?platformType=${platformType}${options ? `&${Object.entries(options).map(([key, val]) => `${key}=${val}`).join("&")}` : ""}`, {
			method: "GET", headers: { "X-Riot-Token": riotToken }
		}).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getConsoleLeaderboard", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getConsoleLeaderboard(cache, rateLimits, actId, platformType, region, riotToken, options)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.consoleLeaderboard[region][platformType][actId] = { ...json, lastUpdate: Date.now() };
					
					resolve(json);
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
		
		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getStatus.count >= rateLimit.getStatus.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}status/v1/platform-data`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getStatus", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getStatus(cache, rateLimits, region, riotToken)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.status[region] = { ...json, lastUpdate: Date.now() };
					
					resolve(json);
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
function getContent(cache: Cache, rateLimits: RateLimits, region: Region, riotToken: string, locale: keyof LocalizedNames | undefined): Promise<Content<boolean> | string> {
	return new Promise((resolve, reject) => {
		const rateLimit = rateLimits[region], cacheValue = cache.content[region][locale || "all"];

		if (cacheValue?.lastUpdate && cacheValue.lastUpdate + 300000 <= Date.now()) resolve(cacheValue);
		else if (rateLimit.app[0].count >= rateLimit.app[0].max || rateLimit.app[1].count >= rateLimit.app[1].max) reject("App Rate Limit");
		else if (rateLimit.getContent.count >= rateLimit.getContent.max) reject("Method Rate Limit");
		else fetch(`https://${region.toLowerCase()}${BASE_URL}content/v1/contents${locale ? `?locale=${locale}`: ""}`, { method: "GET", headers: { "X-Riot-Token": riotToken } }).then(res => {
			const retryAfterHeader = res.headers.get("retry-after");

			updateRateLimit(rateLimit, "getContent", res.headers);

			if (retryAfterHeader && res.status == 429) setTimeout(async () => resolve(await getContent(cache, rateLimits, region, riotToken, locale)), parseInt(retryAfterHeader) * 1000);
			else res.json().then(json => {
				if (res.status.toString()[0] == "2") {
					cache.content[region][locale || "all"] = { ...json, lastUpdate: Date.now() };
					
					resolve(json);
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
			AP: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getConsoleLeaderboard: { count: 0, max: Infinity, timeout: null },
				getConsoleMatch: { count: 0, max: Infinity, timeout: null },
				getConsolePlayerMatches: { count: 0, max: Infinity, timeout: null },
				getConsoleRecentMatches: { count: 0, max: Infinity, timeout: null },
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null },
			},
			BR: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getConsoleLeaderboard: { count: 0, max: Infinity, timeout: null },
				getConsoleMatch: { count: 0, max: Infinity, timeout: null },
				getConsolePlayerMatches: { count: 0, max: Infinity, timeout: null },
				getConsoleRecentMatches: { count: 0, max: Infinity, timeout: null },
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null },
			},
			ESPORTS: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getConsoleLeaderboard: { count: 0, max: Infinity, timeout: null },
				getConsoleMatch: { count: 0, max: Infinity, timeout: null },
				getConsolePlayerMatches: { count: 0, max: Infinity, timeout: null },
				getConsoleRecentMatches: { count: 0, max: Infinity, timeout: null },
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null },
			},
			EU: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getConsoleLeaderboard: { count: 0, max: Infinity, timeout: null },
				getConsoleMatch: { count: 0, max: Infinity, timeout: null },
				getConsolePlayerMatches: { count: 0, max: Infinity, timeout: null },
				getConsoleRecentMatches: { count: 0, max: Infinity, timeout: null },
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null },
			},
			KR: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getConsoleLeaderboard: { count: 0, max: Infinity, timeout: null },
				getConsoleMatch: { count: 0, max: Infinity, timeout: null },
				getConsolePlayerMatches: { count: 0, max: Infinity, timeout: null },
				getConsoleRecentMatches: { count: 0, max: Infinity, timeout: null },
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null },
			},
			LATAM: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getConsoleLeaderboard: { count: 0, max: Infinity, timeout: null },
				getConsoleMatch: { count: 0, max: Infinity, timeout: null },
				getConsolePlayerMatches: { count: 0, max: Infinity, timeout: null },
				getConsoleRecentMatches: { count: 0, max: Infinity, timeout: null },
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null },
			},
			NA: {
				app: [{ count: 0, max: Infinity, timeout: null }, { count: 0, max: Infinity, timeout: null }],
				getConsoleLeaderboard: { count: 0, max: Infinity, timeout: null },
				getConsoleMatch: { count: 0, max: Infinity, timeout: null },
				getConsolePlayerMatches: { count: 0, max: Infinity, timeout: null },
				getConsoleRecentMatches: { count: 0, max: Infinity, timeout: null },
				getContent: { count: 0, max: Infinity, timeout: null },
				getLeaderboard: { count: 0, max: Infinity, timeout: null },
				getMatch: { count: 0, max: Infinity, timeout: null },
				getPlayerMatches: { count: 0, max: Infinity, timeout: null },
				getRecentMatches: { count: 0, max: Infinity, timeout: null },
				getStatus: { count: 0, max: Infinity, timeout: null },
			},
		}

		this.cache = {
			consoleLeaderboard: { AP: { playstation: {}, xbox: {} }, EU: { playstation: {}, xbox: {} }, NA: { playstation: {}, xbox: {} } },
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
			leaderboard: { AP: {}, BR: {}, EU: {}, KR: {}, LATAM: {}, NA: {} },
			match: { AP: {}, BR: {}, EU: {}, KR: {}, LATAM: {}, NA: {}, ESPORTS: {} },
			consoleMatch: { AP: { playstation: {}, xbox: {} }, EU: { playstation: {}, xbox: {} }, NA: { playstation: {}, xbox: {} }, },
			playerMatches: { AP: {}, BR: {}, EU: {}, KR: {}, LATAM: {}, NA: {}, ESPORTS: {} },
			recentMatches: { AP: {}, BR: {}, EU: {}, KR: {}, LATAM: {}, NA: {}, ESPORTS: {} },
			status: { AP: null, BR: null, EU: null, KR: null, LATAM: null, NA: null },
			consolePlayerMatches: { AP: { playstation: {}, xbox: {} }, EU: { playstation: {}, xbox: {} }, NA: { playstation: {}, xbox: {} } },
			consoleRecentMatches: { AP: {}, EU: {}, NA: {} }
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
	getStatus(region: Exclude<Region, "ESPORTS">): Promise<PlatformData | string> { return getStatus(this.cache, this.rateLimits, region, this.riotToken) };

	/**
	 * Get leaderboard for the competitive queue
	 * @param actId Act ids can be found using the val-content API.
	 */
	getLeaderboard(actId: string, options: LeaderboardOptions, region: Exclude<Region, "ESPORTS">): Promise<Leaderboard | string> { return getLeaderboard(this.cache, this.rateLimits, actId, region, this.riotToken, options) };

	/**
	 * Get leaderboard for the competitive queue
	 * @param actId Act ids can be found using the val-content API.
	 */
	getConsoleLeaderboard(actId: string, platformType: PlatformTypes, options: LeaderboardOptions, region: ConsoleRegion): Promise<Leaderboard | string> { return getConsoleLeaderboard(this.cache, this.rateLimits, actId, platformType, region, this.riotToken, options) };

	/**
	 * Get matchlist for games played by puuid 
	 */
	getPlayerMatches(puuid: Puuid, region: Region) { return getPlayerMatches(this.cache, this.rateLimits, puuid, region, this.riotToken) };

	/**
	 * Get matchlist for games played by puuid 
	 */
	getConsolePlayerMatches(puuid: Puuid, region: ConsoleRegion, platform: PlatformTypes) { return getConsolePlayerMatches(this.cache, this.rateLimits, puuid, region, platform, this.riotToken) };

	/**
	 * Get match by id
	 */
	getMatch(matchId: string, region: Region) { return getMatch(this.cache, this.rateLimits, matchId, region, this.riotToken) };

	/**
	 * Get match by id
	 */
	getConsoleMatch(matchId: string, region: ConsoleRegion, platform: PlatformTypes) { return getConsoleMatch(this.cache, this.rateLimits, matchId, region, platform, this.riotToken) };
	
	/**
   * Get recent matches
   * 
   * Returns a list of match ids that have completed in the last 10 minutes for live regions and 12 hours for the esports routing value.
   * NA/LATAM/BR share a match history deployment.
   * As such, recent matches will return a combined list of matches from those three regions.
   * Requests are load balanced so you may see some inconsistencies as matches are added/removed from the list.
	 */
	getRecentMatches(queue: Queues, region: Region): Promise<RecentMatches | string> { return getRecentMatches(this.cache, this.rateLimits, queue, region, this.riotToken); };

	/**
   * Get recent matches
   * 
   * Returns a list of match ids that have completed in the last 10 minutes for live regions and 12 hours for the esports routing value.
   * NA/LATAM/BR share a match history deployment.
   * As such, recent matches will return a combined list of matches from those three regions.
   * Requests are load balanced so you may see some inconsistencies as matches are added/removed from the list.
	 */
	getConsoleRecentMatches(queue: ConsoleQueues, region: ConsoleRegion): Promise<RecentMatches | string> { return getConsoleRecentMatches(this.cache, this.rateLimits, queue, region, this.riotToken); };
}

// Types

type FunctionName = "getContent" | "getStatus" | "getLeaderboard" | "getConsoleLeaderboard" | "getPlayerMatches" | "getConsolePlayerMatches" | "getMatch" | "getConsoleMatch" | "getRecentMatches" | "getConsoleRecentMatches";

export type RateLimits = Record<Region, Record<"app", [RateLimit, RateLimit]> & Record<FunctionName, RateLimit>>;

export type Puuid = string;

export type Region = "AP" | "BR" | "ESPORTS" | "EU" | "KR" | "LATAM" | "NA";

export type ConsoleRegion = "AP" | "EU" | "NA";

// Interfaces

export interface Cache {
	content: Record<Region, Record<keyof LocalizedNames, Content<true> & { lastUpdate: number } | null> & Record<"all", Content<false> & { lastUpdate: number } | null>>;
	status: Record<Exclude<Region, "ESPORTS">, PlatformData & { lastUpdate: number } | null>;
	leaderboard: Record<Exclude<Region, "ESPORTS">, Record<string, Leaderboard & { lastUpdate: number }>>;
	consoleLeaderboard: Record<ConsoleRegion, Record<PlatformTypes, Record<string, Leaderboard & { lastUpdate: number }>>>;
	playerMatches: Record<Region, Record<Puuid, MatchList & { lastUpdate: number }>>;
	consolePlayerMatches: Record<ConsoleRegion, Record<PlatformTypes, Record<Puuid, MatchList & { lastUpdate: number }>>>;
	match: Record<Region, Record<string, Match & { lastUpdate: number }>>;
	consoleMatch: Record<ConsoleRegion, Record<PlatformTypes, Record<string, Match & { lastUpdate: number }>>>;
	recentMatches: Record<Region, Record<string, RecentMatches & { lastUpdate: number }>>;
	consoleRecentMatches: Record<ConsoleRegion, Record<string, RecentMatches & { lastUpdate: number }>>;
}

export interface Act {
	name: string;
	/**
	 * This field is excluded from the response when a locale is set
	 */
	localizedNames?: LocalizedNames | undefined;
	id: string;
	isActive: boolean;
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
	acts: (LocaleIsSet extends true ? Omit<Act, "localizedNames"> : Act)[];
}

export interface RecentMatches {
	currentTime: number;
	/**
	 * A list of recent match ids.
	 */
	matchIds: string[];
}

export interface Match {
	matchInfo: MatchInfo;
	players: MatchPlayer[];
	coaches: Coach[];
	teams: Team[];
	roundResults: RoundResult[];
}

export interface RoundResult {
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
	plantPlayerLocations: PlayerLocations[];
	plantLocation: Location;
	plantSite: string;
	defuseRoundTime: number;
	defusePlayerLocations: PlayerLocations[];
	playerStats: PlayerRoundStats[];
	roundResultCode: string;
}

export interface PlayerRoundStats {
	puuid: Puuid;
	kills: Kill[];
	damage: Damage[];
	score: number;
	economy: Economy;
	ability: Ability;
}

export interface Damage {
	/**
	 * PUUID
	 */
	receiver: Puuid;
	damage: number;
	legshots: number;
	bodyshots: number;
	headshots: number;
}

export interface Kill {
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
	assistants: string[];
	playerLocations: PlayerLocations[];
	finishingDamage: FinishingDamage;
}

export interface PlayerLocations {
	puuid: Puuid;
	viewRadians: number;
	location: Location;
}

export interface Coach {
	puuid: Puuid;
	teamId: string;
}

export interface MatchPlayer {
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

export interface MatchListEntry {
	matchId: string;
	gameStartTimeMillis: number;
	queueId: string;
}

export interface Player {
	/**
	 * This field may be omitted if the player has been anonymized.
	 */
	puuid?: Puuid;
	/**
	 * This field may be omitted if the player has been anonymized.
	 */
	gameName?: string;
	/**
	 * This field may be omitted if the player has been anonymized.
	 */
	tagLine?: string;
	leaderboardRank: number;
	rankedRating: number;
	numberOfWins: number;
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
	players: Player[];
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

export interface Team {
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

export interface PlatformData {
	id: string;
	name: string;
	locales: string[];
	maintenances: Status[];
	incidents: Status[];
}

export interface Status {
	id: number;
	maintenance_status: MaintenanceStatus;
	incident_severity: IncidentSeverities;
	titles: StatusContent[];
	updates: Update[];
	created_at: string;
	archive_at: string;
	updated_at: string;
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
	publish_locations: PublishLocations[];
	translations: StatusContent[];
	created_at: string;
	updated_at: string;
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
}

export enum ConsoleQueues {
	Unrated = "console_unrated",
	Deathmatch = "console_deathmatch",
	Ggteam = "console_swiftplay",
	Hurm = "console_hurm",
}