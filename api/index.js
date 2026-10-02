const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "d659c9a6006168cfeee99cd51cad6623";

const manifest = {
    "id": "org.myself.imdb.tasteprofile.curator",
    "version": "4.2.0",
    "name": "TasteProfile Precision Engine",
    "description": "Post-2005 psychological thrillers, grounded sci-fi & European puzzles.",
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

const WATCHED_TITLES = new Set([
    "tt0482571", "tt2543164", "tt0945513", "tt7286456", "tt1189340",
    "tt17009710", "tt6908274", "tt1219289", "tt1375666", "tt0816692",
    "tt0468569", "tt1853728", "tt0110912", "tt0137523", "tt0111161",
    "tt1877832", "tt2166834", "tt2313197", "tt0409459", "tt10530176",
    "tt2267998", "tt0477348", "tt0443706", "tt3170832", "tt0405094",
    "tt2084970", "tt1130884", "tt0361748", "tt1392190", "tt0892791",
    "tt5311514", "tt2278388", "tt0993846", "tt1345836", "tt0407887",
    "tt0372784", "tt1856101", "tt4779682", "tt10872600", "tt10366460",
    "tt15671028", "tt15398776", "tt1517268", "tt9362722", "tt6710474",
    "tt1160419"
]);

// Strip animation (16) and documentaries (99)
const TMDB_EXCLUSIONS = "&without_genres=16,99";

async function resolveToStremioMetas(results, isSeries = false, limit = 50) {
    const endpoint = isSeries ? "tv" : "movie";

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
            const imdbId = extRes.data ? extRes.data.imdb_id : null;

            if (!imdbId || !/^tt\d{7,8}$/.test(imdbId)) return null;
            if (WATCHED_TITLES.has(imdbId)) return null;

            const year = (item.release_date || item.first_air_date || "").split("-")[0];

            return {
                id: imdbId,
                type: isSeries ? "series" : "movie",
                name: isSeries ? item.name : item.title,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                description: item.overview || "",
                releaseInfo: year
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
        const url = `https://api.themoviedb.org/3/discover/${endpoint}?api_key=${TMDB_API_KEY}&${baseParams}&${dateParam}${TMDB_EXCLUSIONS}&page=${p}`;
        pagePromises.push(axios.get(url, { timeout: 3500 }).catch(() => ({ data: { results: [] } })));
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
        let baseQuery = "";
        let isSeries = (type === "series");
        let startPage = Math.floor(Math.random() * 2) + 1;

        if (id === "cat_grounded_scifi") {
            baseQuery = "with_genres=878&without_keywords=161176,9882,3801&vote_average.gte=6.3&vote_count.gte=150&sort_by=popularity.desc";
        } 
        else if (id === "cat_tight_thrillers") {
            baseQuery = "with_genres=9648|53&vote_average.gte=6.6&vote_count.gte=200&sort_by=vote_average.desc";
        } 
        else if (id === "cat_dark_character") {
            // FIXED: Drama OR Thriller (18|53), dropped without_genres=28, loosened to 6.5+
            baseQuery = "with_genres=18|53&vote_average.gte=6.5&vote_count.gte=150&sort_by=vote_average.desc";
        } 
        else if (id === "cat_forensic_crime") {
            baseQuery = "with_genres=80&vote_average.gte=6.6&vote_count.gte=150&sort_by=vote_average.desc";
        } 
        else if (id === "cat_euro_mystery") {
            baseQuery = "with_original_language=es|fr|de|it&with_genres=9648|53&vote_average.gte=6.4&vote_count.gte=50&sort_by=vote_average.desc";
        } 
        else if (id === "cat_tense_survival") {
            // FIXED: Thriller (53), removed restrictive exclusion tags, sorted by popularity
            baseQuery = "with_genres=53&vote_average.gte=6.3&vote_count.gte=120&sort_by=popularity.desc";
        } 
        else if (id === "cat_modern_noir") {
            baseQuery = "with_genres=80&vote_average.gte=6.6&vote_count.gte=150&sort_by=popularity.desc";
        } 
        else if (id === "cat_clever_heist") {
            baseQuery = "with_genres=80,53&vote_average.gte=6.5&vote_count.gte=120&sort_by=popularity.desc";
        } 
        else if (id === "cat_fresh_wildcard") {
            // FIXED: Removed duplicate &page param from query string, set startPage cleanly
            startPage = Math.floor(Math.random() * 3) + 1;
            baseQuery = "with_genres=9648|53|878&without_keywords=161176,9882,3801&vote_average.gte=6.5&vote_count.gte=150&sort_by=popularity.desc";
        } 
        else if (id === "cat_prestige_series") {
            baseQuery = "with_genres=18,9648&vote_average.gte=7.2&vote_count.gte=60&sort_by=vote_average.desc";
        }

        if (!baseQuery) return { metas: [] };

        const raw = await fetchMultiPage(baseQuery, isSeries, startPage, 3);
        const metas = await resolveToStremioMetas(raw, isSeries, 50);
        return { metas };

    } catch (err) {
        console.error(`Catalog error on ${id}:`, err.message);
        return { metas: [] };
    }
});

const router = getRouter(builder.getInterface());

module.exports = (req, res) => {
    router(req, res, (err) => {
        if (err) res.status(500).send(err.message);
        else res.status(404).send("Not Found");
    });
};
