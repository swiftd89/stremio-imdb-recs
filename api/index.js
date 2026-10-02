const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "d659c9a6006168cfeee99cd51cad6623";

// STRICTLY declare catalog only so Cinemeta handles the detail screen and yellow badge
const manifest = {
    "id": "org.myself.imdb.tasteprofile.curator",
    "version": "4.0.0",
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

// Explicit list of your watched/favorite titles to guarantee exclusion
const WATCHED_TITLES = new Set([
    "tt0482571", // The Prestige
    "tt2543164", // Arrival
    "tt0945513", // Source Code
    "tt7286456", // Joker
    "tt1189340", // The Skin I Live In
    "tt17009710", // Anatomy of a Fall
    "tt6908274", // Mirage
    "tt1219289", // Limitless
    "tt1375666", // Inception
    "tt0816692", // Interstellar
    "tt0468569", // The Dark Knight
    "tt1853728", // Django Unchained
    "tt0110912", // Pulp Fiction
    "tt0137523", // Fight Club
    "tt0111161", // The Shawshank Redemption
    "tt1877832", // X-Men: Days of Future Past
    "tt2166834", // Batman: Dark Knight Returns Pt 2
    "tt2313197", // Batman: Dark Knight Returns Pt 1
    "tt0409459", // Watchmen
    "tt10530176", // The Call
    "tt2267998", // Gone Girl
    "tt0477348", // No Country for Old Men
    "tt0443706", // Zodiac
    "tt3170832", // Room
    "tt0405094", // The Lives of Others
    "tt2084970", // The Imitation Game
    "tt1130884", // Shutter Island
    "tt0361748", // Inglourious Basterds
    "tt1392190", // Mad Max: Fury Road
    "tt0892791", // The Secret in Their Eyes
    "tt5311514", // Your Name
    "tt2278388", // The Grand Budapest Hotel
    "tt0993846", // The Wolf of Wall Street
    "tt1345836", // The Dark Knight Rises
    "tt0407887", // The Departed
    "tt0372784", // Batman Begins
    "tt1856101", // Blade Runner 2049
    "tt4779682", // Giant Little Ones
    "tt10872600", // Spider-Man: No Way Home
    "tt10366460", // CODA
    "tt15671028", // Godzilla Minus One
    "tt15398776", // Oppenheimer
    "tt1517268", // Barbie
    "tt9362722", // Spider-Man: Across the Spider-Verse
    "tt6710474", // Everything Everywhere All at Once
    "tt1160419"  // Dune
]);

// Strip animations (16) and documentaries (99)
const TMDB_EXCLUSIONS = "&without_genres=16,99";

async function resolveToStremioMetas(results, isSeries = false, limit = 40) {
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

            // Return clean Stremio catalog item so Cinemeta attaches ratings and badges
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
        const metas = await resolveToStremioMetas(raw, isSeries, 40);
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
