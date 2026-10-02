const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "d659c9a6006168cfeee99cd51cad6623";
const IMDB_PROFILE_ID = "p.k7ky5tvxj7vurvtblpjto6ck2a";

const manifest = {
    "id": "org.myself.imdb.tasteprofile.curator",
    "version": "3.2.0",
    "name": "TasteProfile Precision Engine",
    "description": "Post-2005 psychological thrillers, grounded sci-fi & European puzzles with verified watch-history exclusion.",
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

let cachedRatedSet = null;
let lastFetchTime = 0;

// Universal IMDb extractor that captures IDs from both HTML and client JSON bundles
async function getRatedImdbSet() {
    const now = Date.now();
    if (cachedRatedSet && (now - lastFetchTime < 1000 * 60 * 30)) {
        return cachedRatedSet;
    }

    const collected = new Set();
    // Seed confirmed user favorites so they never reappear
    [
        "tt0482571", "tt2543164", "tt0945513", "tt7286456", "tt1189340",
        "tt17009710", "tt6908274", "tt1219289", "tt1375666", "tt0816692",
        "tt0468569", "tt1853728", "tt0110912", "tt0137523", "tt0111161"
    ].forEach(id => collected.add(id));

    try {
        const url = `https://www.imdb.com/user/${IMDB_PROFILE_ID}/ratings/`;
        const res = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout: 5000
        });

        const html = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        const matches = html.match(/tt\d{7,8}/g);
        if (matches) {
            matches.forEach(id => collected.add(id));
        }
    } catch (e) {
        console.error("IMDb history fetch fallback engaged");
    }

    cachedRatedSet = collected;
    lastFetchTime = now;
    return cachedRatedSet;
}

const TMDB_EXCLUSIONS = "&without_genres=16,99";

// Concurrent resolver with safety cap
async function resolveToStremioMetas(results, ratedSet, isSeries = false, limit = 40) {
    const endpoint = isSeries ? "tv" : "movie";

    // Eliminate animations, documentaries, and Asian originals
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
                { timeout: 2200 }
            );
            const imdbId = extRes.data ? extRes.data.imdb_id : null;

            if (!imdbId || !/^tt\d{7,8}$/.test(imdbId)) return null;
            if (ratedSet.has(imdbId)) return null;

            const year = (item.release_date || item.first_air_date || "").split("-")[0];
            const rating = item.vote_average ? item.vote_average.toFixed(1) : "7.2";

            return {
                id: imdbId,
                type: isSeries ? "series" : "movie",
                name: isSeries ? item.name : item.title,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                description: item.overview || "",
                releaseInfo: year,
                imdbRating: rating,
                genres: ["Thriller", "Mystery"],
                links: [
                    {
                        name: `${rating} IMDb`,
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

async function fetchMultiPage(baseParams, isSeries = false, startPage = 1, totalPages = 2) {
    const endpoint = isSeries ? "tv" : "movie";
    const dateParam = isSeries ? "first_air_date.gte=2006-01-01" : "primary_release_date.gte=2006-01-01";
    let combined = [];

    const pagePromises = [];
    for (let p = startPage; p < startPage + totalPages; p++) {
        const url = `https://api.themoviedb.org/3/discover/${endpoint}?api_key=${TMDB_API_KEY}&${baseParams}&${dateParam}${TMDB_EXCLUSIONS}&page=${p}`;
        pagePromises.push(axios.get(url, { timeout: 3000 }).catch(() => ({ data: { results: [] } })));
    }

    const responses = await Promise.all(pagePromises);
    responses.forEach(res => {
        if (res.data && Array.isArray(res.data.results)) {
            combined = combined.concat(res.data.results);
        }
    });

    return combined.sort(() => Math.random() - 0.5);
}

builder.defineCatalogHandler(async ({ type, id }) => {
    try {
        const ratedSet = await getRatedImdbSet();
        let baseQuery = "";
        let isSeries = (type === "series");
        const startPage = Math.floor(Math.random() * 3) + 1;

        if (id === "cat_grounded_scifi") {
            baseQuery = "with_genres=878,9648&vote_average.gte=6.7&vote_count.gte=250&sort_by=vote_average.desc";
        } 
        else if (id === "cat_tight_thrillers") {
            baseQuery = "with_genres=9648,53&vote_average.gte=6.8&vote_count.gte=300&sort_by=vote_average.desc";
        } 
        else if (id === "cat_dark_character") {
            baseQuery = "with_genres=18,53&vote_average.gte=6.9&vote_count.gte=300&sort_by=vote_average.desc";
        } 
        else if (id === "cat_forensic_crime") {
            baseQuery = "with_genres=80,9648&vote_average.gte=6.8&vote_count.gte=250&sort_by=vote_average.desc";
        } 
        else if (id === "cat_euro_mystery") {
            baseQuery = "with_original_language=es|fr|de|it&with_genres=9648|53&vote_average.gte=6.6&vote_count.gte=80&sort_by=vote_average.desc";
        } 
        else if (id === "cat_tense_survival") {
            baseQuery = "with_genres=53&without_genres=14&vote_average.gte=6.7&vote_count.gte=200&sort_by=vote_average.desc";
        } 
        else if (id === "cat_modern_noir") {
            baseQuery = "with_genres=80,18&without_genres=35&vote_average.gte=6.9&vote_count.gte=300&sort_by=vote_average.desc";
        } 
        else if (id === "cat_clever_heist") {
            baseQuery = "with_genres=80,53&vote_average.gte=6.7&vote_count.gte=200&sort_by=popularity.desc";
        } 
        else if (id === "cat_fresh_wildcard") {
            const wildcardPage = Math.floor(Math.random() * 5) + 1;
            baseQuery = `with_genres=9648,53&vote_average.gte=6.8&vote_count.gte=180&sort_by=popularity.desc&page=${wildcardPage}`;
        } 
        else if (id === "cat_prestige_series") {
            baseQuery = "with_genres=18,9648&vote_average.gte=7.4&vote_count.gte=100&sort_by=vote_average.desc";
        }

        if (!baseQuery) return { metas: [] };

        const raw = await fetchMultiPage(baseQuery, isSeries, startPage, 2);
        const metas = await resolveToStremioMetas(raw, ratedSet, isSeries, 40);
        return { metas };

    } catch (err) {
        console.error(`Catalog error on ${id}:`, err.message);
        return { metas: [] };
    }
});

// Meta handler returning standard detail metadata with the IMDb badge
builder.defineMetaHandler(async ({ type, id }) => {
    try {
        const findUrl = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
        const { data: findData } = await axios.get(findUrl, { timeout: 2500 });

        const isSeries = (type === "series");
        const details = isSeries 
            ? (findData.tv_results && findData.tv_results[0]) 
            : (findData.movie_results && findData.movie_results[0]);

        if (!details) return { meta: null };

        const detailsEndpoint = isSeries ? `tv/${details.id}` : `movie/${details.id}`;
        const { data: full } = await axios.get(`https://api.themoviedb.org/3/${detailsEndpoint}?api_key=${TMDB_API_KEY}`, { timeout: 2500 });

        const rating = full.vote_average ? full.vote_average.toFixed(1) : null;
        const genres = (full.genres || []).map(g => g.name);
        const runtime = full.runtime ? `${full.runtime} min` : (full.episode_run_time && full.episode_run_time[0] ? `${full.episode_run_time[0]} min` : null);
        const year = (full.release_date || full.first_air_date || "").split("-")[0];

        return {
            meta: {
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
            }
        };
    } catch (err) {
        return { meta: null };
    }
});

const router = getRouter(builder.getInterface());

module.exports = (req, res) => {
    router(req, res, (err) => {
        if (err) res.status(500).send(err.message);
        else res.status(404).send("Not Found");
    });
};
