const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const TMDB_API_KEY = "d659c9a6006168cfeee99cd51cad6623";
const IMDB_PROFILE_ID = "p.k7ky5tvxj7vurvtblpjto6ck2a";

const manifest = {
    "id": "org.myself.imdb.tasteprofile.curator",
    "version": "3.1.0",
    "name": "TasteProfile Precision Engine",
    "description": "High-concept psychological thrillers, grounded sci-fi, and airtight European mysteries (No anime, no space opera).",
    "resources": ["catalog", "meta"],
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

const FALLBACK_FAVORITES = [
    "tt1375666", "tt0816692", "tt0482571", "tt2543164", "tt0945513",
    "tt7286456", "tt1189340", "tt17009710", "tt6908274", "tt1219289"
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

// Global query exclusions that TMDB natively supports:
// without_genres=16 (No Animation/Anime), without_genres=99 (No Documentaries/Making-ofs)
const TMDB_NATIVE_EXCLUSIONS = "&without_genres=16,99";

async function resolveToStremioMetas(results, ratedSet, isSeries = false, limit = 50) {
    const endpoint = isSeries ? "tv" : "movie";

    // Filter in JS to avoid TMDB 400 parameter errors:
    // 1. Exclude animation (16) and documentaries (99)
    // 2. Exclude East Asian language productions (ja, ko, zh)
    const filtered = results.filter(item => {
        if (!item || !item.id) return false;
        if (item.genre_ids && (item.genre_ids.includes(16) || item.genre_ids.includes(99))) return false;
        if (["ja", "ko", "zh"].includes(item.original_language)) return false;
        return true;
    });

    const promises = filtered.map(async (item) => {
        try {
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
                imdbRating: rating,
                links: [
                    {
                        name: rating ? `${rating} IMDb` : "IMDb",
                        category: "imdb",
                        url: `https://www.imdb.com/title/${rawImdbId}/`
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
        const url = `https://api.themoviedb.org/3/discover/${endpoint}?api_key=${TMDB_API_KEY}&${baseParams}&${dateParam}${TMDB_NATIVE_EXCLUSIONS}&page=${p}`;
        pagePromises.push(axios.get(url, { timeout: 3500 }).catch(() => ({ data: { results: [] } })));
    }

    const responses = await Promise.all(pagePromises);
    responses.forEach(res => {
        if (res.data && Array.isArray(res.data.results)) {
            combined = combined.concat(res.data.results);
        }
    });

    // Slight shuffle for dynamic discovery
    return combined.sort(() => Math.random() - 0.5);
}

builder.defineCatalogHandler(async ({ type, id }) => {
    try {
        const ratedIds = await getRatedImdbIds(IMDB_PROFILE_ID);
        const ratedSet = new Set(ratedIds);

        let baseQuery = "";
        let isSeries = (type === "series");
        // Safe random window (1 to 2) so we never overshoot pagination into empty pages
        const startPage = Math.floor(Math.random() * 2) + 1;

        if (id === "cat_grounded_scifi") {
            // Source Code / Arrival / Time loop concepts (No space operas)
            baseQuery = "with_genres=878,9648&vote_average.gte=6.8&vote_count.gte=300&sort_by=vote_average.desc";
        } 
        else if (id === "cat_tight_thrillers") {
            // The Prestige / Mirage / The Body style plot twists
            baseQuery = "with_genres=9648,53&without_genres=28,12&vote_average.gte=7.0&vote_count.gte=350&sort_by=vote_average.desc";
        } 
        else if (id === "cat_dark_character") {
            // Joker / The Skin I Live In style
            baseQuery = "with_genres=18,53&without_genres=28&vote_average.gte=7.1&vote_count.gte=300&sort_by=vote_average.desc";
        } 
        else if (id === "cat_forensic_crime") {
            // Zodiac / Wind River style investigations
            baseQuery = "with_genres=80,9648,53&vote_average.gte=7.0&vote_count.gte=300&sort_by=vote_average.desc";
        } 
        else if (id === "cat_euro_mystery") {
            // Anatomy of a Fall / European thrillers (ES, FR, DE, IT)
            baseQuery = "with_original_language=es|fr|de|it&with_genres=9648|53|80&vote_average.gte=6.8&vote_count.gte=80&sort_by=vote_average.desc";
        } 
        else if (id === "cat_tense_survival") {
            // Pressure cookers and suspense
            baseQuery = "with_genres=53&without_genres=28,14&vote_average.gte=6.9&vote_count.gte=250&sort_by=vote_average.desc";
        } 
        else if (id === "cat_modern_noir") {
            // Gritty neo-noir & urban crime
            baseQuery = "with_genres=80,18&without_genres=35,10749&vote_average.gte=7.1&vote_count.gte=350&sort_by=vote_average.desc";
        } 
        else if (id === "cat_clever_heist") {
            // Mind games & calculated schemes
            baseQuery = "with_genres=80,53&vote_average.gte=6.8&vote_count.gte=250&sort_by=popularity.desc";
        } 
        else if (id === "cat_fresh_wildcard") {
            // Broad shuffle of top-rated psychological thrillers
            const wildcardPage = Math.floor(Math.random() * 4) + 1;
            baseQuery = `with_genres=9648,53&vote_average.gte=7.0&vote_count.gte=200&sort_by=popularity.desc&page=${wildcardPage}`;
        } 
        else if (id === "cat_prestige_series") {
            baseQuery = "with_genres=18,9648&vote_average.gte=7.6&vote_count.gte=100&sort_by=vote_average.desc";
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

// Meta handler ensuring runtime, genres, rating, and badge appear on title click
builder.defineMetaHandler(async ({ type, id }) => {
    try {
        const findUrl = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
        const { data: findData } = await axios.get(findUrl, { timeout: 3000 });

        const isSeries = (type === "series");
        const details = isSeries 
            ? (findData.tv_results && findData.tv_results[0]) 
            : (findData.movie_results && findData.movie_results[0]);

        if (!details) return { meta: null };

        const detailsEndpoint = isSeries ? `tv/${details.id}` : `movie/${details.id}`;
        const { data: full } = await axios.get(`https://api.themoviedb.org/3/${detailsEndpoint}?api_key=${TMDB_API_KEY}`, { timeout: 3000 });

        const rating = full.vote_average ? full.vote_average.toFixed(1) : null;
        const genres = (full.genres || []).map(g => g.name);
        const runtime = full.runtime ? `${full.runtime} min` : null;
        const year = (full.release_date || full.first_air_date || "").split("-")[0];

        const meta = {
            id: id,
            type: isSeries ? "series" : "movie",
            name: isSeries ? full.name : full.title,
            genres: genres,
            poster: full.poster_path ? `https://image.tmdb.org/t/p/w500${full.poster_path}` : null,
            background: full.backdrop_path ? `https://image.tmdb.org/t/p/original${full.backdrop_path}` : null,
            description: full.overview || "",
            releaseInfo: year,
            runtime: runtime,
            imdbRating: rating,
            links: [
                {
                    name: rating ? `${rating} IMDb` : "IMDb",
                    category: "imdb",
                    url: `https://www.imdb.com/title/${id}/`
                }
            ]
        };

        return { meta };
    } catch (err) {
        return { meta: null };
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
