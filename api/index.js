const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");

const TMDB_API_KEY = "d659c9a6006168cfeee99cd51cad6623";

const manifest = {
    "id": "org.myself.imdb.tasteprofile.curator",
    "version": "5.0.0",
    "name": "TasteProfile Precision Engine",
    "description": "Custom recommendation graph seeded by your 9 & 10/10 IMDb ratings with full 164-title history shield.",
    "resources": ["catalog"],
    "types": ["movie", "series"],
    "catalogs": [
        { "type": "movie", "id": "cat_seed_temporal", "name": "⏳ Mind Benders & Time Puzzles (Seeded)" },
        { "type": "movie", "id": "cat_seed_euro_twist", "name": "🇪🇺 European Twists & Forensics (Seeded)" },
        { "type": "movie", "id": "cat_seed_pressure", "name": "⚡ Contained Pressure Cookers (Seeded)" },
        { "type": "movie", "id": "cat_grounded_scifi", "name": "🧠 Grounded Sci-Fi & Speculative" },
        { "type": "movie", "id": "cat_tight_thrillers", "name": "🕵️ Airtight Murder Mysteries & Twists" },
        { "type": "movie", "id": "cat_dark_character", "name": "🃏 Intense Psychological Studies" },
        { "type": "movie", "id": "cat_forensic_crime", "name": "🔍 Gritty Procedural & Investigation" },
        { "type": "movie", "id": "cat_clever_heist", "name": "♟️ Calculated Mind Games & Schemes" },
        { "type": "movie", "id": "cat_fresh_wildcard", "name": "🎲 Dynamic Psychological Shuffle" },
        { "type": "series", "id": "cat_prestige_series", "name": "📺 Tight Mystery & Thriller Series" }
    ],
    "idPrefixes": ["tt"]
};

const builder = new addonBuilder(manifest);

// COMPLETE 164-TITLE WATCH HISTORY FROM YOUR IMDB RATINGS CSV
const WATCHED_TITLES = new Set([
    "tt17009710", "tt5651844", "tt1103987", "tt2910814", "tt2234222",
    "tt10275044", "tt15574124", "tt29567915", "tt1631707", "tt0186151",
    "tt4565380", "tt10676052", "tt6467482", "tt33043892", "tt32376165",
    "tt31938062", "tt14190592", "tt31429675", "tt31407004", "tt15398776",
    "tt9603208", "tt1495708", "tt5511582", "tt6461812", "tt7366338",
    "tt1190634", "tt31806037", "tt31790115", "tt4604612", "tt31790114",
    "tt11280740", "tt13654226", "tt14961016", "tt15552142", "tt11301886",
    "tt1291570", "tt1136608", "tt8110640", "tt13210838", "tt3620860",
    "tt13016388", "tt9293564", "tt6386204", "tt12298506", "tt9561862",
    "tt5290382", "tt10048342", "tt2085059", "tt7335184", "tt4635282",
    "tt9698442", "tt8778064", "tt1392170", "tt1790864", "tt0309698",
    "tt4178092", "tt0264464", "tt0268978", "tt0993846", "tt22074164",
    "tt19854762", "tt2442560", "tt1632701", "tt4474344", "tt16030542",
    "tt2304589", "tt0944947", "tt14400246", "tt13365348", "tt14586350",
    "tt0117381", "tt2884206", "tt15325794", "tt0482571", "tt0449487",
    "tt3820128", "tt6304314", "tt0816692", "tt7422100", "tt11615812",
    "tt6851528", "tt4392396", "tt6538336", "tt13325946", "tt7115850",
    "tt0102926", "tt0109830", "tt0137523", "tt7253316", "tt4321306",
    "tt9229720", "tt12935234", "tt7307318", "tt1798195", "tt13265098",
    "tt6956566", "tt22477180", "tt8164750", "tt5580390", "tt1924396",
    "tt0756683", "tt10640346", "tt6468322", "tt15438246", "tt0139809",
    "tt2669336", "tt0209144", "tt2267998", "tt0480669", "tt9764362",
    "tt0183649", "tt8946378", "tt1431045", "tt2084970", "tt0421715",
    "tt0240772", "tt3110958", "tt1670345", "tt1483013", "tt1276104",
    "tt1631867", "tt1375666", "tt14379784", "tt6499752", "tt0289992",
    "tt5875444", "tt3631112", "tt1649418", "tt2866360", "tt1243957",
    "tt15215512", "tt11080108", "tt0496806", "tt1187064", "tt6908274",
    "tt6436726", "tt14164730", "tt11286314", "tt0475276", "tt4477976",
    "tt9421570", "tt11698590", "tt8633478", "tt1196946", "tt6341832",
    "tt6723592", "tt1060277", "tt2436386", "tt0773262", "tt0460649",
    "tt4815122", "tt1130884", "tt0945513", "tt5753856", "tt2543164",
    "tt7286456", "tt10431500", "tt4052886", "tt2741602", "tt2106651",
    "tt2467372", "tt2798920", "tt6292852", "tt2548396",
    // Added safety set
    "tt0468569", "tt1853728", "tt0110912", "tt0111161", "tt0477348",
    "tt0443706", "tt1189340", "tt1219289"
]);

// TMDB ID SEEDS FROM YOUR 9 & 10 RATED FAVORITES
const SEEDS = {
    temporal: [
        220289, // Coherence
        26466,  // Triangle
        4995,   // Timecrimes
        449443, // Upgrade
        110972, // Caddo Lake
        438631, // Dune (or similar high concept)
        60625   // Predestination
    ],
    euro_twist: [
        915935, // Anatomy of a Fall
        381288, // The Invisible Guest
        143370, // The Body
        153518, // The Best Offer
        505058, // Mirage
        77875   // Sleep Tight
    ],
    pressure: [
        567690, // Oxygen
        581392, // 7500
        1817,   // Phone Booth
        9614,   // Identity
        146233, // Prisoners
        286567  // The Gift
    ]
};

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
            if (year && parseInt(year) < 2006) return null;

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

// Fetch recommendations directly from a random seed movie
async function fetchSeedRecommendations(seedList) {
    const randomSeed = seedList[Math.floor(Math.random() * seedList.length)];
    try {
        const [recsRes, simRes] = await Promise.all([
            axios.get(`https://api.themoviedb.org/3/movie/${randomSeed}/recommendations?api_key=${TMDB_API_KEY}`, { timeout: 3500 }),
            axios.get(`https://api.themoviedb.org/3/movie/${randomSeed}/similar?api_key=${TMDB_API_KEY}`, { timeout: 3500 })
        ]);
        const recs = (recsRes.data && recsRes.data.results) || [];
        const sim = (simRes.data && simRes.data.results) || [];
        return recs.concat(sim).sort(() => Math.random() - 0.5);
    } catch {
        return [];
    }
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
        let isSeries = (type === "series");
        let rawResults = [];

        // 1. SEED-DRIVEN CATALOGS (Direct ML graph from your 9 & 10 ratings)
        if (id === "cat_seed_temporal") {
            rawResults = await fetchSeedRecommendations(SEEDS.temporal);
        }
        else if (id === "cat_seed_euro_twist") {
            rawResults = await fetchSeedRecommendations(SEEDS.euro_twist);
        }
        else if (id === "cat_seed_pressure") {
            rawResults = await fetchSeedRecommendations(SEEDS.pressure);
        }
        // 2. DISCOVER CATALOGS (Post-2005 tuned taste parameters)
        else {
            let baseQuery = "";
            let startPage = Math.floor(Math.random() * 2) + 1;

            if (id === "cat_grounded_scifi") {
                baseQuery = "with_genres=878&without_keywords=161176,9882,3801&vote_average.gte=6.3&vote_count.gte=150&sort_by=popularity.desc";
            } 
            else if (id === "cat_tight_thrillers") {
                baseQuery = "with_genres=9648|53&vote_average.gte=6.6&vote_count.gte=200&sort_by=vote_average.desc";
            } 
            else if (id === "cat_dark_character") {
                baseQuery = "with_genres=18|53&vote_average.gte=6.5&vote_count.gte=150&sort_by=vote_average.desc";
            } 
            else if (id === "cat_forensic_crime") {
                baseQuery = "with_genres=80&vote_average.gte=6.6&vote_count.gte=150&sort_by=vote_average.desc";
            } 
            else if (id === "cat_clever_heist") {
                baseQuery = "with_genres=80,53&vote_average.gte=6.5&vote_count.gte=120&sort_by=popularity.desc";
            } 
            else if (id === "cat_fresh_wildcard") {
                startPage = Math.floor(Math.random() * 3) + 1;
                baseQuery = "with_genres=9648|53|878&without_keywords=161176,9882,3801&vote_average.gte=6.5&vote_count.gte=150&sort_by=popularity.desc";
            } 
            else if (id === "cat_prestige_series") {
                baseQuery = "with_genres=18,9648&vote_average.gte=7.2&vote_count.gte=60&sort_by=vote_average.desc";
            }

            if (!baseQuery) return { metas: [] };
            rawResults = await fetchMultiPage(baseQuery, isSeries, startPage, 3);
        }

        const metas = await resolveToStremioMetas(rawResults, isSeries, 50);
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
