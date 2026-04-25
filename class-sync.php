<?php
/**
 * Clase para manejar la sincronización con la API de CdelU
 */

if (!defined('ABSPATH')) {
    exit;
}

class CdelU_Sync {
    private $logger;
    private $api_url;
    private $api_key;
    private $sync_mode; // standard, firebase, both
    private $firebase_url;
    private $firebase_key;
    private $timeout = 30;
    private $posts_to_sync = array(); // Array para guardar posts a sincronizar

    public function __construct($logger) {
        $this->logger = $logger;
        $this->api_url = get_option('cdelu_sync_api_url', '');
        $this->api_key = get_option('cdelu_sync_api_key', '');
        $this->sync_mode = get_option('cdelu_sync_mode', 'standard');
        $this->firebase_url = get_option('cdelu_sync_firebase_url', '');
        $this->firebase_key = get_option('cdelu_sync_firebase_key', '');
        
        // En desarrollo local, aumentar timeout
        $timeout_option = intval(get_option('cdelu_sync_timeout', 30));
        $this->timeout = !empty($timeout_option) ? $timeout_option : 30;


        // Hook para marcar posts que necesitan sincronización
        add_action('transition_post_status', array($this, 'mark_post_for_sync'), 10, 3);
        
        // Hook shutdown se ejecuta DESPUÉS de TODO (incluyendo JetEngine y ACF)
        add_action('shutdown', array($this, 'process_sync_queue'));
        
        // Hook AJAX para sincronización manual
        add_action('wp_ajax_cdelu_sync_post', array($this, 'ajax_sync_post'));
    }

    /**
     * Verificar si la URL es localhost
     */
    private function is_localhost($url) {
        $host = parse_url($url, PHP_URL_HOST);
        return in_array($host, array('localhost', '127.0.0.1', '::1'));
    }

    /**
     * Marcar un post para sincronización (cuando cambia a publish)
     */
    public function mark_post_for_sync($new_status, $old_status, $post) {
        // Solo sincronizar cuando pasa a publicado
        if ($new_status !== 'publish') {
            return;
        }

        // Si es una revisión o auto-guardado, ignorar
        if (wp_is_post_revision($post->ID) || wp_is_post_autosave($post->ID)) {
            return;
        }

        // Verificar que sea un post habilitado
        if (!$this->is_post_type_enabled($post->post_type)) {
            return;
        }

        // Si fuerza sincronización está marcada, permitir resincronización
        $force_sync = get_post_meta($post->ID, '_cdelu_force_sync', true);
        
        // Solo sincronizar si no fue sincronizado antes (o si se fuerza)
        $already_synced = get_post_meta($post->ID, '_cdelu_synced', true);
        if (!$force_sync && $already_synced) {
            return;
        }

        // Agregar el post a la cola para sincronización
        $this->posts_to_sync[] = $post->ID;
    }

    /**
     * Procesar la cola de sincronización (se ejecuta en shutdown, DESPUÉS de TODO)
     */
    public function process_sync_queue() {
        // Si no hay posts para sincronizar, salir
        if (empty($this->posts_to_sync)) {
            return;
        }

        // Sincronizar cada post
        foreach ($this->posts_to_sync as $post_id) {
            $this->sync_post($post_id);
            
            // Eliminar flag de fuerza sincronización
            $force_sync = get_post_meta($post_id, '_cdelu_force_sync', true);
            if ($force_sync) {
                delete_post_meta($post_id, '_cdelu_force_sync');
            }
        }
    }

    /**
     * Hook transition_post_status - Se ejecuta cuando el post cambia de estado a "publish"
     */
    public function sync_on_publish($new_status, $old_status, $post) {
        // Solo sincronizar cuando pasa a publicado
        if ($new_status !== 'publish') {
            return;
        }

        // Si es una revisión o auto-guardado, ignorar
        if (wp_is_post_revision($post->ID) || wp_is_post_autosave($post->ID)) {
            return;
        }

        // Verificar que sea un post habilitado
        if (!$this->is_post_type_enabled($post->post_type)) {
            return;
        }

        // Si fuerza sincronización está marcada, permitir resincronización
        $force_sync = get_post_meta($post->ID, '_cdelu_force_sync', true);
        
        // Solo sincronizar si no fue sincronizado antes (o si se fuerza)
        $already_synced = get_post_meta($post->ID, '_cdelu_synced', true);
        if (!$force_sync && $already_synced) {
            return;
        }

        // Pequeño delay para asegurar que JetEngine termine de guardar
        sleep(1);

        // Ejecutar sincronización
        $this->sync_post($post->ID);
        
        // Eliminar flag de fuerza sincronización
        if ($force_sync) {
            delete_post_meta($post->ID, '_cdelu_force_sync');
        }
    }

    /**
     * Hook wp_after_insert_post - Se ejecuta DESPUÉS de que todo está guardado
     */
    public function sync_on_insert_post($post_id, $post, $update, $post_before) {
        // Llamar al método sync_on_save con los parámetros adecuados
        $this->sync_on_save($post_id, $post, $update);
    }

    /**
     * Sincronizar cuando se guarda un post
     */
    public function sync_on_save($post_id, $post, $update) {
        // Nos saltamos revisiones y auto-guardados
        if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
            return;
        }

        // Verificar que sea un post habilitado
        if (!$this->is_post_type_enabled($post->post_type)) {
            return;
        }

        // Solo sincronizar posts publicados
        if ($post->post_status !== 'publish') {
            return;
        }

        // Si fuerza sincronización está marcada, permitir resincronización
        $force_sync = get_post_meta($post_id, '_cdelu_force_sync', true);
        
        if (!$force_sync && get_post_meta($post_id, '_cdelu_synced', true)) {
            return;
        }

        // Ejecutar sincronización
        $this->sync_post($post_id);
        
        // Eliminar flag de fuerza sincronización
        if ($force_sync) {
            delete_post_meta($post_id, '_cdelu_force_sync');
        }
    }

    /**
     * Sincronizar un post específico
     */
    public function sync_post($post_id) {
        static $already_synced_in_request = array();

        // Evitar múltiples ejecuciones para el mismo post en una misma petición PHP
        if (isset($already_synced_in_request[$post_id])) {
            return true;
        }

        $already_synced_in_request[$post_id] = true;

        // Ignorar revisiones y auto-guardados también aquí por seguridad
        if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
            return false;
        }

        // Deshabilitar envío a API Standard
        if ($this->sync_mode === 'standard' || $this->sync_mode === 'both') {
            $this->sync_mode = 'firebase';
        }

        $mode = $this->sync_mode;
        $success = false;
        $responses = array();

        try {
            $post = get_post($post_id);
            if (!$post) {
                throw new Exception('Post no encontrado');
            }

            // Preparar datos
            $data = $this->prepare_post_data($post);
            $this->validate_post_data($data);

            // --- SINCRONIZACIÓN STANDARD ---
            if ($mode === 'standard' || $mode === 'both') {
                if (!empty($this->api_url)) {
                    $response = $this->send_to_api($data);
                    $responses['standard'] = $response;
                    if ($response['success']) {
                        $success = true;
                        $this->logger->log('Sincronización Standard: Exitosa', 'success', $post_id, array(
                            'status' => 'success',
                            'response_code' => $response['code'],
                            'request_body' => $data,
                            'api_response' => $response,
                        ));
                    } else {
                        $this->logger->log('Error Standard: ' . $response['message'], 'error', $post_id, array(
                            'status' => 'error',
                            'response_code' => $response['code'],
                            'request_body' => $data,
                            'api_response' => $response,
                        ));
                    }
                }
            }

            // --- SINCRONIZACIÓN FIREBASE ---
            if ($mode === 'firebase' || $mode === 'both') {
                if (!empty($this->firebase_url)) {
                    $response = $this->send_to_firebase($data);
                    $responses['firebase'] = $response;
                    if ($response['success']) {
                        $success = true;
                        $this->logger->log('Sincronización Firebase: Exitosa', 'success', $post_id, array(
                            'status' => 'success',
                            'response_code' => $response['code'],
                            'request_body' => $data,
                            'api_response' => $response,
                        ));
                    } else {
                        $this->logger->log('Error Firebase: ' . $response['message'], 'error', $post_id, array(
                            'status' => 'error',
                            'response_code' => $response['code'],
                            'request_body' => $data,
                            'api_response' => $response,
                        ));
                    }
                }
            }

            if ($success) {
                // Registrar post como sincronizado
                update_post_meta($post_id, '_cdelu_synced', '1');
                update_post_meta($post_id, '_cdelu_sync_time', current_time('mysql'));
                
                // Si hubo respuesta Standard con ID, guardarlo
                if (isset($responses['standard']['data']['id'])) {
                    update_post_meta($post_id, '_cdelu_response_id', $responses['standard']['data']['id']);
                }

                return true;
            }
            
            return false;

        } catch (Exception $e) {
            $this->logger->log(
                'Excepción: ' . $e->getMessage(),
                'error',
                $post_id,
                array('status' => 'error')
            );

            return false;
        }
    }

    /**
     * Enviar datos a Firebase (Realtime DB con formato JSON)
     */
    private function send_to_firebase($data) {
        $url = rtrim($this->firebase_url, '/');

        // Si la URL termina en .json, eliminarla para construir la ruta con el ID del post
        if (substr($url, -5) === '.json') {
            $url = substr($url, 0, -5);
        }

        // Asegurar la ruta base /news
        if (!preg_match('#/news(?:/|$)#', $url)) {
            $url .= '/news';
        }

        // Forzar la ruta exacta /news/{ID}.json para que los envíos posteriores sobrescriban el mismo nodo
        if (!empty($data['postId'])) {
            $url = preg_replace('#/news(?:/.*)?$#', '/news/' . intval($data['postId']), $url);
        } else {
            $url = preg_replace('#/news(?:/.*)?$#', '/news', $url);
        }

        $url .= '.json';

        // Añadir Auth si existe
        if (!empty($this->firebase_key)) {
            $url = add_query_arg('auth', $this->firebase_key, $url);
        }

        $args = array(
            'body' => wp_json_encode($data),
            'headers' => array(
                'Content-Type' => 'application/json',
            ),
            'method' => 'PUT',
            'timeout' => $this->timeout,
            'sslverify' => !$this->is_localhost($url)
        );

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            return array(
                'success' => false,
                'code' => 0,
                'message' => $response->get_error_message()
            );
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code >= 200 && $code < 300) {
            return array(
                'success' => true,
                'code' => $code,
                'data' => json_decode(wp_remote_retrieve_body($response), true)
            );
        }

        return array(
            'success' => false,
            'code' => $code,
            'message' => 'Firebase Error: ' . wp_remote_retrieve_body($response)
        );
    }


    /**
     * Preparar datos del post (Adaptado a Esquema Firebase /content)
     */
    private function prepare_post_data($post) {
        // Obtener imagen destacada
        $thumbnail_id = get_post_thumbnail_id($post->ID);
        $image_url = '';
        if ($thumbnail_id) {
            $image_url = wp_get_attachment_url($thumbnail_id);
        }

        // Procesar contenido
        $content = apply_filters('the_content', $post->post_content);
        
        // Opción para remover etiquetas HTML
        if (get_option('cdelu_sync_strip_tags')) {
            $content = wp_strip_all_tags($content, true);
        }

        // Limitar longitud si está configurado
        $max_length = intval(get_option('cdelu_sync_max_length', 5000));
        if ($max_length > 0 && strlen($content) > $max_length) {
            $content = substr($content, 0, $max_length - 3) . '...';
        }

        // Obtener categorías y etiquetas
        $categories = wp_get_post_categories($post->ID, array('fields' => 'names'));
        $category = !empty($categories) ? $categories[0] : '';
        $tags = wp_get_post_tags($post->ID, array('fields' => 'names'));

        $created_at_timestamp = get_post_time('U', true, $post);
        $created_at_iso = gmdate('Y-m-d\TH:i:s\Z', $created_at_timestamp);

        // --- ESTRUCTURA SEGÚN FIREBASE_RESUMEN_EJECUTIVO.txt ---
        $data = array(
            'type'              => 'news', // Identificador de tipo
            'titulo'            => $post->post_title,
            'descripcion'       => $content,
            'images'            => !empty($image_url) ? array($image_url) : array(), // Ahora es un array
            'userId'            => sanitize_text_field(get_option('cdelu_sync_user_id', 'noticias')) ?: 'noticias',
            'userName'          => sanitize_text_field(get_option('cdelu_sync_user_name', '')) ?: get_the_author_meta('display_name', $post->post_author),
            'userProfilePicUrl' => esc_url_raw(get_option('cdelu_sync_user_profile_pic_url', '')) ?: get_avatar_url($post->post_author),
            'stats'             => array(
                'likesCount'    => 0,
                'commentsCount' => 0,
                'viewsCount'    => 0
            ),
            'createdAt'         => $created_at_iso, // ISO 8601 UTC
            'updatedAt'         => current_time('mysql'),
            'deletedAt'         => null,
            'isOficial'         => boolval(get_post_meta($post->ID, '_cdelu_is_oficial', true)),
            'originalUrl'       => get_permalink($post->ID),
            'category'          => $category,
            'tags'              => $tags,
            'postId'            => $post->ID,
        );

        // ========== CAMPOS EXTRA / METADATA ==========
        $post_meta = get_post_meta($post->ID);
        $custom_fields = array();
        if (!empty($post_meta)) {
            foreach ($post_meta as $key => $values) {
                if (strpos($key, '_') === 0 || strpos($key, 'cdelu') === 0) continue;
                $value = is_array($values) && count($values) === 1 ? $values[0] : $values;
                $custom_fields[$key] = $value;
            }
        }
        
        if (!empty($custom_fields)) {
            $data['custom_fields'] = $custom_fields;
        }

        // Permitir filtro final
        $data = apply_filters('cdelu_sync_post_data', $data, $post);

        return $data;
    }


    /**
     * Validar datos del post
     */
    private function validate_post_data($data) {
        if (empty($data['titulo'])) {
            throw new Exception('El título del post es requerido');
        }

        if (empty($data['descripcion'])) {
            throw new Exception('La descripción del post es requerida');
        }

        // Validar array de imágenes
        if (!empty($data['images']) && is_array($data['images'])) {
            foreach ($data['images'] as $url) {
                if (!filter_var($url, FILTER_VALIDATE_URL)) {
                    throw new Exception('Una de las URLs de imagen no es válida');
                }
            }
        }

        if (!filter_var($data['originalUrl'], FILTER_VALIDATE_URL)) {
            throw new Exception('La URL original no es válida');
        }
    }


    /**
     * Enviar datos a la API
     */
    private function send_to_api($data) {
        // En localhost, desactivar verificación SSL para desarrollo local
        $sslverify = !$this->is_localhost($this->api_url);
        
        $args = array(
            'body' => wp_json_encode($data),
            'headers' => array(
                'Content-Type' => 'application/json',
                'X-API-Key' => $this->api_key,
                'User-Agent' => 'CdelU-Sync-Pro/2.0.0'
            ),
            'timeout' => $this->timeout,
            'redirection' => 5,
            'blocking' => true,
            'sslverify' => $sslverify
        );

        $response = wp_remote_post($this->api_url, $args);

        if (is_wp_error($response)) {
            return array(
                'success' => false,
                'code' => 0,
                'message' => $response->get_error_message()
            );
        }

        $response_code = wp_remote_retrieve_response_code($response);
        $response_body = wp_remote_retrieve_body($response);
        $response_data = json_decode($response_body, true);

        // Aceptar 200, 201, 202 como exitosos
        if (in_array($response_code, array(200, 201, 202))) {
            return array(
                'success' => true,
                'code' => $response_code,
                'data' => $response_data
            );
        } else {
            return array(
                'success' => false,
                'code' => $response_code,
                'message' => $response_body ?: 'Error HTTP ' . $response_code
            );
        }
    }

    /**
     * Verificar si el tipo de post está habilitado
     */
    private function is_post_type_enabled($post_type) {
        $enabled_types = get_option('cdelu_sync_enabled_types', array('post'));
        
        if (is_string($enabled_types)) {
            $enabled_types = array_map('trim', explode(',', $enabled_types));
        }

        return in_array($post_type, (array)$enabled_types);
    }

    /**
     * AJAX: Sincronizar post manualmente
     */
    public function ajax_sync_post() {
        // Verificar nonce
        if (!isset($_POST['nonce']) || !wp_verify_nonce($_POST['nonce'], 'cdelu_sync_nonce')) {
            wp_send_json_error('Nonce inválido');
        }

        // Verificar permisos
        if (!current_user_can('edit_posts')) {
            wp_send_json_error('Permiso denegado');
        }

        $post_id = intval($_POST['post_id']);
        if (!$post_id) {
            wp_send_json_error('ID de post inválido');
        }

        $post = get_post($post_id);
        if (!$post) {
            wp_send_json_error('Post no encontrado');
        }

        // Evitar sincronizar revisiones o autoguardados también en la llamada AJAX manual
        if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
            wp_send_json_error('No se puede sincronizar una revisión o autoguardado');
        }

        // Ejecutar sincronización
        $result = $this->sync_post($post_id);

        if ($result) {
            wp_send_json_success(array(
                'message' => 'Post sincronizado exitosamente',
                'sync_time' => get_post_meta($post_id, '_cdelu_sync_time', true)
            ));
        } else {
            $last_log = $this->logger->get_post_last_log($post_id);
            wp_send_json_error(
                'Error: ' . ($last_log ? $last_log->message : 'Error desconocido')
            );
        }
    }

    /**
     * Obtener URL de API
     */
    public function get_api_url() {
        return $this->api_url;
    }

    /**
     * Establecer URL de API
     */
    public function set_api_url($url) {
        $this->api_url = $url;
    }

    /**
     * Obtener API Key
     */
    public function get_api_key() {
        return $this->api_key;
    }

    /**
     * Establecer API Key
     */
    public function set_api_key($key) {
        $this->api_key = $key;
    }

    /**
     * Verificar conexión a API/Firebase
     */
    public function test_connection() {
        $mode = $this->sync_mode;
        $results = array();

        // 1. Probar Standard API
        if ($mode === 'standard' || $mode === 'both') {
            if (empty($this->api_url) || empty($this->api_key)) {
                $results['standard'] = array('success' => false, 'message' => 'Faltan datos de API Standard');
            } else {
                $sslverify = !$this->is_localhost($this->api_url);
                $args = array(
                    'method' => 'HEAD',
                    'headers' => array('X-API-Key' => $this->api_key),
                    'timeout' => 10,
                    'sslverify' => $sslverify
                );
                $response = wp_remote_post($this->api_url, $args);
                if (is_wp_error($response)) {
                    $results['standard'] = array('success' => false, 'message' => 'Error API: ' . $response->get_error_message());
                } else {
                    $code = wp_remote_retrieve_response_code($response);
                    $results['standard'] = ($code >= 200 && $code < 500) 
                        ? array('success' => true, 'message' => 'API Standard OK (Code ' . $code . ')')
                        : array('success' => false, 'message' => 'Error API (Code ' . $code . ')');
                }
            }
        }

        // 2. Probar Firebase
        if ($mode === 'firebase' || $mode === 'both') {
            if (empty($this->firebase_url)) {
                $results['firebase'] = array('success' => false, 'message' => 'Falta URL de Firebase');
            } else {
                $url = $this->firebase_url;
                if (strpos($url, 'firebaseio.com') !== false && strpos($url, '.json') === false) {
                    $url = rtrim($url, '/') . '/.json'; // Test root with .json
                }
                if (!empty($this->firebase_key)) {
                    $url = add_query_arg('auth', $this->firebase_key, $url);
                }
                
                $response = wp_remote_get($url, array('timeout' => 10, 'sslverify' => !$this->is_localhost($url)));
                if (is_wp_error($response)) {
                    $results['firebase'] = array('success' => false, 'message' => 'Error Firebase: ' . $response->get_error_message());
                } else {
                    $code = wp_remote_retrieve_response_code($response);
                    $results['firebase'] = ($code >= 200 && $code < 300) 
                        ? array('success' => true, 'message' => 'Firebase OK')
                        : array('success' => false, 'message' => 'Firebase Error (Code ' . $code . ')');
                }
            }
        }

        // Compilar mensaje final
        $messages = array();
        $all_success = true;
        foreach ($results as $type => $res) {
            $messages[] = strtoupper($type) . ': ' . $res['message'];
            if (!$res['success']) $all_success = false;
        }

        return array(
            'success' => $all_success,
            'message' => implode(' | ', $messages)
        );
    }

}
?>
