const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const TMDB_API_KEY = "d659c9a6006168cfeee99cd51cad6623";
const IMDB_PROFILE_ID = "p.k7ky5tvxj7vurvtblpjto6ck2a";

const manifest = {
    "id": "org.myself.imdb.tasteprofile.curator",
    "version": "3.0.0",
    "name": "TasteProfile Precision Engine",
    "description": "High-concept psychological thrillers, grounded sci-fi, and airtight European mysteries (No anime, no space opera).",
    "resources": ["catalog"],
    "types": ["movie", "series"],
    "catalogs": [
        { "type": "movie", "id": "cat_grounded_scifi", "name": "🧠 Grounded Sci-Fi & Time Causality" },
        { "type": "movie", "id": "cat_tight_thrillers", "name": "🕵️ Airtight Mysteries & Twists" },
        { "type": "movie", "id": "cat_dark_character", "name": "🃏 Intense Psychological Studies" },
        { "type": "movie", "id": "cat_forensic_crime", "name": "🔍 Gritty Procedural & Investigation" },
        { "type": "movie", "id": "cat_euro_mystery", "name": "🇪🇺 European Neo-Thrillers & Puzzles" },
        { "type": "movie", "id": "cat_tense_survival", "name": "⚡ High-Stakes Pressure Cookers" },
        { "type": "movie", "id": "cat_modern_noir", "name": "🌧️ Modern Gritty Neo-Noir" },
        { "type": "movie", "id": "cat_clever_heist", "name": "♟️ Calculated Mind Games & Schemes" },
        { "type": "movie", "id": "cat_fresh_wildcard", "name": "🎲 Dynamic Psychological Shuffle" },
        { "type": "series", "id": "cat_prestige_series", "name": "📺 Tight Mystery & Thriller Series" }
    ],
    "idPrefixes": ["tt"]
};

const builder = new addonBuilder(manifest);

// Seed titles from user's explicit favorites
const FALLBACK_FAVORITES = [
    "tt1375666", // Inception
    "tt0816692", // Interstellar
    "tt0482571", // The Prestige
    "tt2543164", // Arrival
    "tt0945513", // Source Code
    "tt7286456", // Joker
    "tt1189340", // The Skin I Live In
    "tt17009710", // Anatomy of a Fall
    "tt6908274", // Mirage
    "tt1219289"  // Limitless
];

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

// Global hard filters applied across every TMDB request:
// - without_genres=16 (NO ANIMATION/ANIME), 99 (NO DOCUMENTARIES/MAKING-OF)
// - without_keywords=161176,9882,3801 (NO Space Opera, Star Trek, Space Battles)
// - without_original_language=ja,ko,zh (NO Anime/Manga adaptations or Asian drama)
const HARD_EXCLUSIONS = "&without_genres=16,99&without_keywords=161176,9882,3801&without_original_language=ja,ko,zh";

async function resolveToStremioMetas(results, ratedSet, isSeries = false, limit = 50) {
    const endpoint = isSeries ? "tv" : "movie";

    const promises = results.map(async (item) => {
        try {
            // Guard: double filter animation, documentaries, and Asian originals if leaked
            if (item.genre_ids && (item.genre_ids.includes(16) || item.genre_ids.includes(99))) return null;
            if (["ja", "ko", "zh"].includes(item.original_language)) return null;

            const extRes = await axios.get(
                `https://api.themoviedb.org/3/${endpoint}/${item.id}/external_ids?api_key=${TMDB_API_KEY}`,
                { timeout: 2500 }
            );
            const rawImdbId = extRes.data ? extRes.data.imdb_id : null;

            if (!rawImdbId || !/^tt\d{7,8}$/.test(rawImdbId)) return null;
            if (ratedSet.has(rawImdbId)) return null;

            const year = (item.release_date || item.first_air_date || "").split("-")[0];
            const rating = item.vote_average ? item.vote_average.toFixed(1) : null;

            return {
                id: rawImdbId,
                type: isSeries ? "series" : "movie",
                name: isSeries ? item.name : item.title,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                description: item.overview || "",
                releaseInfo: year,
                imdbRating: rating
            };
        } catch {
            return null;
        }
    });

    const resolved = await Promise.all(promises);
    return resolved.filter(Boolean).slice(0, limit);
}

// Fetches 3 pages while applying random starting page offsets to keep catalogs fresh
async function fetchMultiPage(baseParams, isSeries = false, basePage = 1, totalPages = 3) {
    const endpoint = isSeries ? "tv" : "movie";
    const dateParam = isSeries ? "first_air_date.gte=2006-01-01" : "primary_release_date.gte=2006-01-01";
    let combined = [];

    const pagePromises = [];
    for (let p = basePage; p < basePage + totalPages; p++) {
        const url = `https://api.themoviedb.org/3/discover/${endpoint}?api_key=${TMDB_API_KEY}&${baseParams}&${dateParam}${HARD_EXCLUSIONS}&page=${p}`;
        pagePromises.push(axios.get(url, { timeout: 3500 }).catch(() => ({ data: { results: [] } })));
    }

    const responses = await Promise.all(pagePromises);
    responses.forEach(res => {
        if (res.data && Array.isArray(res.data.results)) {
            combined = combined.concat(res.data.results);
        }
    });

    // Shuffle within the batch for constant refresh
    return combined.sort(() => Math.random() - 0.5);
}

builder.defineCatalogHandler(async ({ type, id }) => {
    try {
        const ratedIds = await getRatedImdbIds(IMDB_PROFILE_ID);
        const ratedSet = new Set(ratedIds);

        let baseQuery = "";
        let isSeries = (type === "series");
        // Dynamic random page window (1 to 4) so recommendations refresh on every request
        const dynamicStartPage = Math.floor(Math.random() * 4) + 1;

        if (id === "cat_grounded_scifi") {
            // Source Code / Arrival style: Time loops, paradoxes, high concept without space operas
            baseQuery = "with_genres=878,9648&vote_average.gte=7.1&vote_count.gte=600&sort_by=vote_average.desc";
        } 
        else if (id === "cat_tight_thrillers") {
            // The Prestige / Mirage / The Body style: Airtight plot twists & mystery
            baseQuery = "with_genres=9648,53&without_genres=28,12&vote_average.gte=7.2&vote_count.gte=700&sort_by=vote_average.desc";
        } 
        else if (id === "cat_dark_character") {
            // Joker / The Skin I Live In style: Dark psychological drama & obsession
            baseQuery = "with_genres=18,53&without_genres=28&vote_average.gte=7.3&vote_count.gte=800&sort_by=vote_average.desc";
        } 
        else if (id === "cat_forensic_crime") {
            // Zodiac / Wind River style: Deep investigation, cold cases, realistic police procedure
            baseQuery = "with_genres=80,9648,53&vote_average.gte=7.2&vote_count.gte=600&sort_by=vote_average.desc";
        } 
        else if (id === "cat_euro_mystery") {
            // Anatomy of a Fall / Spanish & French thriller puzzles (Oriol Paulo vibes)
            baseQuery = "with_original_language=es|fr|de|it|da&with_genres=9648,53&vote_average.gte=7.0&vote_count.gte=200&sort_by=vote_average.desc";
        } 
        else if (id === "cat_tense_survival") {
            // Contained, nerve-wracking suspense (e.g. Locke, Buried, Room, Misery style)
            baseQuery = "with_genres=53&without_genres=28,14&vote_average.gte=7.2&vote_count.gte=500&sort_by=vote_average.desc";
        } 
        else if (id === "cat_modern_noir") {
            // Gritty, cynical urban crime (No Country, Nightcrawler, Prisoners style)
            baseQuery = "with_genres=80,18&without_genres=35,10749&vote_average.gte=7.3&vote_count.gte=800&sort_by=vote_average.desc";
        } 
        else if (id === "cat_clever_heist") {
            // Calculated schemes and mind games (Inside Man, Focus style)
            baseQuery = "with_genres=80,53&with_keywords=10051|642|10182&vote_average.gte=6.9&vote_count.gte=400&sort_by=vote_average.desc";
        } 
        else if (id === "cat_fresh_wildcard") {
            // Deep randomized pull across all high-rated psychological mystery/sci-fi
            const deepPage = Math.floor(Math.random() * 8) + 1;
            baseQuery = `with_genres=9648,53&vote_average.gte=7.2&vote_count.gte=400&sort_by=popularity.desc&page=${deepPage}`;
        } 
        else if (id === "cat_prestige_series") {
            baseQuery = "with_genres=18,9648&vote_average.gte=7.8&vote_count.gte=250&sort_by=vote_average.desc";
        }

        if (!baseQuery) return { metas: [] };

        const rawResults = await fetchMultiPage(baseQuery, isSeries, dynamicStartPage, 3);
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
