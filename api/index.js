const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const TMDB_API_KEY = "d659c9a6006168cfeee99cd51cad6623";
const IMDB_PROFILE_ID = "p.k7ky5tvxj7vurvtblpjto6ck2a";

const manifest = {
    "id": "org.myself.imdb.tasteprofile.curator",
    "version": "2.3.0",
    "name": "TasteProfile 10-Catalog Engine",
    "description": "Deep post-2005 catalogs with IMDb badges, watch-history exclusion, and direct links.",
    "resources": ["catalog"],
    "types": ["movie", "series"],
    "catalogs": [
        { "type": "movie", "id": "cat_mind_bending", "name": "🧠 Mind-Bending & High-Concept" },
        { "type": "movie", "id": "cat_psych_thriller", "name": "🕵️ Psychological & Tense Thrillers" },
        { "type": "movie", "id": "cat_hidden_gems", "name": "💎 Hidden Gems (Under-The-Radar)" },
        { "type": "movie", "id": "cat_space_scifi", "name": "🌌 Hard Sci-Fi & Speculative Realism" },
        { "type": "movie", "id": "cat_masterpieces", "name": "🏆 Modern Masterpieces (8.0+)" },
        { "type": "movie", "id": "cat_dark_noir", "name": "🌪️ Dark Neo-Noir & Gritty Crime" },
        { "type": "movie", "id": "cat_timeloop_reality", "name": "⏳ Non-Linear & Alternate Realities" },
        { "type": "movie", "id": "cat_director_vision", "name": "🎬 Visionary Auteur Cinema" },
        { "type": "movie", "id": "cat_smart_wildcard", "name": "🎲 Smart Taste Wildcard" },
        { "type": "series", "id": "cat_prestige_series", "name": "📺 Prestige Miniseries & Drama" }
    ],
    "idPrefixes": ["tt"]
};

const builder = new addonBuilder(manifest);

const FALLBACK_FAVORITES = ["tt1375666", "tt0816692", "tt0468569", "tt0110912", "tt0137523", "tt0111161", "tt0062622", "tt2096673"];

let cachedRatedIds = null;
let lastFetch = 0;

async function getRatedImdbIds(userId) {
    const now = Date.now();
    if (cachedRatedIds && (now - lastFetch < 1000 * 60 * 20)) {
        return cachedRatedIds;
    }

    try {
        const url = `https://www.imdb.com/user/${userId}/ratings/`;
        const { data } = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9"
            },
            timeout: 5000
        });

        const $ = cheerio.load(data);
        const ids = [];
        $('a[href*="/title/tt"]').each((_, el) => {
            const href = $(el).attr("href");
            const match = href ? href.match(/tt\d{7,8}/) : null;
            if (match && !ids.includes(match[0])) ids.push(match[0]);
        });

        cachedRatedIds = ids.length > 0 ? ids : FALLBACK_FAVORITES;
        lastFetch = now;
        return cachedRatedIds;
    } catch {
        return FALLBACK_FAVORITES;
    }
}

// Convert TMDB items to Stremio metas including imdbRating and external links
async function resolveToStremioMetas(results, ratedSet, isSeries = false, limit = 50) {
    const endpoint = isSeries ? "tv" : "movie";

    const promises = results.map(async (item) => {
        try {
            const extRes = await axios.get(
                `https://api.themoviedb.org/3/${endpoint}/${item.id}/external_ids?api_key=${TMDB_API_KEY}`,
                { timeout: 2500 }
            );
            const imdbId = extRes.data ? extRes.data.imdb_id : null;

            if (!imdbId || ratedSet.has(imdbId)) {
                return null;
            }

            const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
            const year = (item.release_date || item.first_air_date || "").split("-")[0];

            return {
                id: imdbId,
                type: isSeries ? "series" : "movie",
                name: isSeries ? item.name : item.title,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                description: item.overview,
                releaseInfo: year,
                imdbRating: rating,
                links: [
                    {
                        name: "IMDb",
                        category: "imdb",
                        url: `https://www.imdb.com/title/${imdbId}/`
                    }
                ]
            };
        } catch {
            return null;
        }
    });

    const resolved = await Promise.all(promises);
    return resolved.filter(Boolean).slice(0, limit);
}

async function fetchMultiPage(baseParams, isSeries = false, startPage = 1, totalPages = 3) {
    const endpoint = isSeries ? "tv" : "movie";
    const dateParam = isSeries ? "first_air_date.gte=2006-01-01" : "primary_release_date.gte=2006-01-01";
    let combined = [];

    const pagePromises = [];
    for (let p = startPage; p < startPage + totalPages; p++) {
        const url = `https://api.themoviedb.org/3/discover/${endpoint}?api_key=${TMDB_API_KEY}&${baseParams}&${dateParam}&page=${p}`;
        pagePromises.push(axios.get(url, { timeout: 3500 }).catch(() => ({ data: { results: [] } })));
    }

    const responses = await Promise.all(pagePromises);
    responses.forEach(res => {
        if (res.data && Array.isArray(res.data.results)) {
            combined = combined.concat(res.data.results);
        }
    });

    return combined;
}

builder.defineCatalogHandler(async ({ type, id }) => {
    try {
        const ratedIds = await getRatedImdbIds(IMDB_PROFILE_ID);
        const ratedSet = new Set(ratedIds);

        let baseQuery = "";
        let isSeries = (type === "series");
        let startPage = 1;

        if (id === "cat_mind_bending") {
            baseQuery = "with_genres=878,9648&vote_average.gte=7.2&vote_count.gte=600&sort_by=vote_average.desc";
        } 
        else if (id === "cat_psych_thriller") {
            baseQuery = "with_genres=53,9648&without_genres=28,12&vote_average.gte=7.3&vote_count.gte=800&sort_by=vote_average.desc";
        } 
        else if (id === "cat_hidden_gems") {
            baseQuery = "vote_average.gte=7.4&vote_count.gte=300&vote_count.lte=4500&sort_by=vote_average.desc";
        } 
        else if (id === "cat_space_scifi") {
            baseQuery = "with_genres=878&with_keywords=9882|3801|161176|14901&vote_average.gte=7.0&vote_count.gte=300&sort_by=vote_average.desc";
        } 
        else if (id === "cat_masterpieces") {
            baseQuery = "vote_average.gte=8.0&vote_count.gte=1500&sort_by=vote_average.desc";
        } 
        else if (id === "cat_dark_noir") {
            baseQuery = "with_genres=80,53&vote_average.gte=7.3&vote_count.gte=600&sort_by=popularity.desc";
        } 
        else if (id === "cat_timeloop_reality") {
            baseQuery = "with_genres=878&with_keywords=4379|1930|9882&vote_average.gte=6.9&vote_count.gte=300&sort_by=vote_average.desc";
        } 
        else if (id === "cat_director_vision") {
            baseQuery = "with_people=525|137427|7467|240|5655|12453&vote_average.gte=7.4&sort_by=vote_average.desc";
        } 
        else if (id === "cat_smart_wildcard") {
            startPage = Math.floor(Math.random() * 3) + 1;
            baseQuery = "with_genres=878|53|9648&vote_average.gte=7.2&vote_count.gte=600&sort_by=vote_average.desc";
        } 
        else if (id === "cat_prestige_series") {
            baseQuery = "with_genres=18,9648&vote_average.gte=8.0&vote_count.gte=300&sort_by=vote_average.desc";
        }

        if (!baseQuery) return { metas: [] };

        const rawResults = await fetchMultiPage(baseQuery, isSeries, startPage, 3);
        const metas = await resolveToStremioMetas(rawResults, ratedSet, isSeries, 50);
        return { metas };

    } catch (err) {
        console.error(`Catalog error on ${id}:`, err.message);
        return { metas: [] };
    }
});

const router = getRouter(builder.getInterface());

module.exports = (req, res) => {
    router(req, res, (err) => {
        if (err) {
            res.status(500).send(err.message);
        } else {
            res.status(404).send("Not Found");
        }
    });
};
