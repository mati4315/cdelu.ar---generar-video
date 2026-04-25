/**
 * Referencia de bot en Node.js
 * Detecta nuevos posts de cdelu-ar usando la API custom que creamos en WordPress
 * 
 * Requisitos:
 * npm install axios
 */

const axios = require('axios');

// Configuracion de tu sitio WordPress
const WP_URL = 'https://cdelu.io'; // O tu dominio principal
const API_ENDPOINT = `${WP_URL}/wp-json/cdelu-video/v1/posts`;

// Si configuraste alguna autenticación en la API (bearer token, etc.), deberias usarla aqui
const getUnprocessedPosts = async () => {
    try {
        console.log(`[Bot] Buscando nuevos posts en ${API_ENDPOINT}...`);
        const response = await axios.get(API_ENDPOINT);
        return response.data; // Array con los posts no procesados
    } catch (error) {
        console.error('[Bot] Error al obtener posts:', error.message);
        return [];
    }
};

const markPostAsProcessed = async (postId) => {
    try {
        const markEndpoint = `${API_ENDPOINT}/${postId}/mark-processed`;
        console.log(`[Bot] Marcando post ${postId} como procesado en ${markEndpoint}`);
        const response = await axios.post(markEndpoint);
        return response.data.success;
    } catch (error) {
        console.error(`[Bot] Error al marcar el post ${postId} como procesado:`, error.message);
        return false;
    }
};

const processVideo = async (postData) => {
    console.log(`\n============================`);
    console.log(`Generando video para el post #${postData.id}`);
    console.log(`Título: ${postData.titulo}`);
    console.log(`Música elegida, imágenes etc...`);
    console.log(`Categoría: ${postData.category}`);
    
    // Aquí es donde meterás la lógica principal de tu otro sistema Nodejs.
    // Ej: Descargar la imagen de postData.images[0]
    // Ej: Generar TTS partiendo de postData.descripcion
    // Ej: Aplicar FFMPEG, etc...
    
    // Simular que el proceso tarda unos segundos
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log(`Video Generado exitosamente para el post #${postData.id}!`);
    console.log(`============================\n`);
    return true; // Éxito
};

// Flujo Principal
const main = async () => {
    console.log("Iniciando Bot de Generación de Videos...");
    
    const unProcessedPosts = await getUnprocessedPosts();
    
    if (!unProcessedPosts || unProcessedPosts.length === 0) {
        console.log("No hay nuevos posts 'cdelu-ar' para procesar de momento.");
        return;
    }
    
    console.log(`Se encontraron ${unProcessedPosts.length} post(s) no procesado(s).`);
    
    // Iterar y procesar uno por uno
    for (const post of unProcessedPosts) {
        try {
            // Generar el video
            const success = await processVideo(post);
            
            // Si el video se generó exitosamente, marcarlo en WordPress para no volver a agarrarlo luego
            if (success) {
                await markPostAsProcessed(post.id);
            }
        } catch (err) {
            console.error(`Error crítico procesando post ${post.id}:`, err);
            // Seguiremos con el proximo post, este no se marcará como procesado
        }
    }
    
    console.log("Bot ha finalizado su iteración.");
};

// Puedes usar node-cron u otro método para correr esto periódicamente
main();
