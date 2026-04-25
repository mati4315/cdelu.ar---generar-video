<?php
/**
 * Panel Administrativo de Cdelu Republisher
 */

class Cdelu_Admin {
    
    private $republisher;
    private $duplicate_detector;
    private $gpt_summarizer;
    
    public function __construct() {
        $this->republisher = new Cdelu_Republisher();
        $this->duplicate_detector = new Cdelu_Duplicate_Detector();
        $this->gpt_summarizer = new Cdelu_GPT_Summarizer();
        
        // Menú admin
        add_action('admin_menu', [$this, 'add_admin_menu']);
        
        // Procesar configuración
        add_action('admin_init', [$this, 'register_settings']);
        add_action('admin_init', [$this, 'handle_form_submissions']);
        add_action('updated_option', [$this, 'handle_cron_schedule_update'], 10, 3);

        
        // Metabox de republición rápida
        add_action('add_meta_boxes', [$this, 'add_meta_boxes']);
        
        // Columnas personalizadas
        add_filter('manage_edit-posts_columns', [$this, 'add_posts_columns']);
        add_action('manage_posts_custom_column', [$this, 'render_posts_column'], 10, 2);
    }
    
    /**
     * Agregar menú administrativo
     */
    public function add_admin_menu() {
        add_menu_page(
            __('Cdelu Republisher', 'cdelu-republisher'),
            __('Cdelu Republisher', 'cdelu-republisher'),
            'manage_options',
            'cdelu-republisher',
            [$this, 'render_dashboard'],
            'dashicons-share',
            25
        );
        
        add_submenu_page(
            'cdelu-republisher',
            __('Dashboard', 'cdelu-republisher'),
            __('Dashboard', 'cdelu-republisher'),
            'manage_options',
            'cdelu-republisher',
            [$this, 'render_dashboard']
        );
        
        add_submenu_page(
            'cdelu-republisher',
            __('Republicar Posts', 'cdelu-republisher'),
            __('Republicar', 'cdelu-republisher'),
            'manage_options',
            'cdelu-republisher-publish',
            [$this, 'render_republish_page']
        );
        
        add_submenu_page(
            'cdelu-republisher',
            __('Configuración', 'cdelu-republisher'),
            __('Configuración', 'cdelu-republisher'),
            'manage_options',
            'cdelu-republisher-settings',
            [$this, 'render_settings_page']
        );
        
        add_submenu_page(
            'cdelu-republisher',
            __('Registros', 'cdelu-republisher'),
            __('Registros', 'cdelu-republisher'),
            'manage_options',
            'cdelu-republisher-logs',
            [$this, 'render_logs_page']
        );
        
        add_submenu_page(
            'cdelu-republisher',
            __('Video Logs', 'cdelu-republisher'),
            __('Video Logs', 'cdelu-republisher'),
            'manage_options',
            'cdelu-republisher-video-logs',
            [$this, 'render_video_logs_page']
        );
    }
    
    /**
     * Registrar configuraciones
     */
    public function register_settings() {
        register_setting('cdelu_settings_group', 'cdelu_gpt_api_key', [
            'sanitize_callback' => function($value) {
                // Si el valor son solo asteriscos, es el valor enmascarado del formulario, no actualizar
                if (preg_match('/^\*+$/', $value)) {
                    return get_option('cdelu_gpt_api_key');
                }
                return sanitize_text_field($value);
            },
            'type' => 'string',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_gpt_model', [
            'sanitize_callback' => function($value) {
                $allowed = ['gpt-5-nano', 'gpt-5.4-nano', 'gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'gpt-4', 'gemini-2.5-flash-lite'];
                return in_array($value, $allowed) ? $value : 'gpt-5-nano';
            },
            'type' => 'string',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_active_ai_provider', [
            'sanitize_callback' => function($value) {
                $allowed = ['openai', 'gemini'];
                return in_array($value, $allowed) ? $value : 'openai';
            },
            'type' => 'string',
            'default' => 'openai',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_gemini_api_key', [
            'sanitize_callback' => function($value) {
                if (empty($value)) {
                    return '';
                }
                // Si los primeros valores son asteriscos, mantener el existente
                if (preg_match('/^\*+$/', $value)) {
                    return get_option('cdelu_gemini_api_key');
                }
                return sanitize_text_field($value);
            },
            'type' => 'string',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_gpt_api_base', [
            'sanitize_callback' => 'esc_url_raw',
            'type' => 'string',
            'default' => 'https://api.openai.com/v1',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_similarity_threshold', [
            'sanitize_callback' => 'absint',
            'type' => 'integer',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_enable_auto_summary', [
            'sanitize_callback' => function($value) { return !empty($value) ? 1 : 0; },
            'type' => 'boolean',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_fail_on_ai_error', [
            'sanitize_callback' => function($value) { return !empty($value) ? 1 : 0; },
            'type' => 'boolean',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_enable_duplicate_check', [
            'sanitize_callback' => function($value) { return !empty($value) ? 1 : 0; },
            'type' => 'boolean',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_auto_republish_mode', [
            'sanitize_callback' => function($value) {
                return in_array($value, ['disabled', 'normal', 'todo']) ? $value : 'disabled';
            },
            'type' => 'string',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_auto_republish_interval', [
            'sanitize_callback' => 'absint',
            'type' => 'integer',
        ]);

        register_setting('cdelu_settings_group', 'cdelu_check_period_days', [
            'sanitize_callback' => 'absint',
            'type' => 'integer',
        ]);
        register_setting('cdelu_settings_group', 'cdelu_summary_length', [
            'sanitize_callback' => function($value) {
                $allowed = ['short', 'medium', 'long', 'normal'];
                return in_array($value, $allowed) ? $value : 'medium';
            },
            'type' => 'string',
        ]);
    }
    
    /**
     * Procesar envíos de formulario
     */
    public function handle_form_submissions() {
        if (!isset($_POST['cdelu_action'])) {
            return;
        }
        
        check_admin_referer('cdelu_admin_nonce', 'cdelu_admin_nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('No autorizado');
        }
        
        $action = sanitize_text_field($_POST['cdelu_action']);
        
        if ($action === 'test_gpt_api') {
            $this->test_gpt_api();
        }
    }

    /**
     * Actualiza el cron cuando se cambian las opciones de republicación.
     */
    public function handle_cron_schedule_update($option, $old_value, $value) {
        if (in_array($option, ['cdelu_auto_republish_mode', 'cdelu_auto_republish_interval'])) {
            wp_clear_scheduled_hook('cdelu_auto_republish_hook');
            
            $mode = get_option('cdelu_auto_republish_mode', 'disabled');
            $interval = (int) get_option('cdelu_auto_republish_interval', 4);
            
            // Si el valor no se ha guardado todavía en bd para get_option, parseamos el value actual
            if ($option === 'cdelu_auto_republish_mode') $mode = $value;
            if ($option === 'cdelu_auto_republish_interval') $interval = (int) $value;
            
            if ($mode !== 'disabled') {
                if ($interval === 1) {
                    $hook_name = 'hourly';
                } elseif ($interval === 24) {
                    $hook_name = 'daily';
                } elseif ($interval === 12) {
                    $hook_name = 'twicedaily';
                } else {
                    $hook_name = "cdelu_every_{$interval}_hours";
                }
                
                wp_schedule_event(time(), $hook_name, 'cdelu_auto_republish_hook');
            }
        }
    }

    
    /**
     * Probar conexión a API de ChatGPT
     */
    private function test_gpt_api() {
        $api_key = get_option('cdelu_gpt_api_key');
        
        if (empty($api_key)) {
            set_transient('cdelu_gpt_test_error', 'API Key no configurada');
            return;
        }
        
        $result = $this->gpt_summarizer->call_openai('Hola', 'short');
        
        if ($result['error']) {
            set_transient('cdelu_gpt_test_error', $result['message'], 5);
        } else {
            set_transient('cdelu_gpt_test_success', 'Conexión OK: ' . $result['summary'], 5);
        }
    }
    
    /**
     * Render: Dashboard
     */
    public function render_dashboard() {
        global $wpdb;
        
        $table = $wpdb->prefix . 'cdelu_logs';
        
        // Estadísticas
        $total_republished = $wpdb->get_var("
            SELECT COUNT(*) FROM $table 
            WHERE action = 'republished'
        ");
        
        $total_skipped = $wpdb->get_var("
            SELECT COUNT(*) FROM $table 
            WHERE action = 'duplicate_skipped'
        ");
        
        $total_posts_cdelu = wp_count_posts('cdelu-ar')->publish ?? 0;
        
        include CDELU_PLUGIN_DIR . 'templates/dashboard.php';
    }
    
    /**
     * Render: Página de Republicación
     */
    public function render_republish_page() {
        // Obtener posts de los últimos días
        $days = (int) get_option('cdelu_check_period_days', 2);
        $date_from = date('Y-m-d H:i:s', strtotime("-$days days"));
        
        $paged = isset($_GET['paged']) ? max(1, intval($_GET['paged'])) : 1;
        $posts_per_page = 10;
        
        $args = [
            'post_type' => 'post',
            'post_status' => 'publish',
            'posts_per_page' => $posts_per_page,
            'paged' => $paged,
            'orderby' => 'date',
            'order' => 'DESC',
            'date_query' => [
                [
                    'after' => $date_from,
                    'compare' => '>=',
                ],
            ],
        ];
        
        $query = new WP_Query($args);
        $posts = $query->posts;
        $total_pages = $query->max_num_pages;
        $current_page = $paged;
        
        include CDELU_PLUGIN_DIR . 'templates/republish-page.php';
    }
    
    /**
     * Render: Página de Configuración
     */
    public function render_settings_page() {
        if (!current_user_can('manage_options')) {
            wp_die('No autorizado');
        }
        
        $gpt_api_key = get_option('cdelu_gpt_api_key');
        $gemini_api_key = get_option('cdelu_gemini_api_key');
        $gpt_api_base = get_option('cdelu_gpt_api_base', 'https://api.openai.com/v1');
        $gpt_model = get_option('cdelu_gpt_model', 'gpt-5-nano');
        $ai_provider_active = get_option('cdelu_active_ai_provider', 'openai');
        $similarity_threshold = (int) get_option('cdelu_similarity_threshold', 85);
        $enable_auto_summary = (bool) get_option('cdelu_enable_auto_summary', 1);
        $fail_on_ai_error = (bool) get_option('cdelu_fail_on_ai_error', 0);
        $enable_duplicate_check = (bool) get_option('cdelu_enable_duplicate_check', 1);
        $auto_republish_mode = get_option('cdelu_auto_republish_mode', 'disabled');
        $auto_republish_interval = (int) get_option('cdelu_auto_republish_interval', 4);
        $check_period_days = (int) get_option('cdelu_check_period_days', 2);
        $summary_length = get_option('cdelu_summary_length', 'medium');

        
        $gpt_test_error = get_transient('cdelu_gpt_test_error');
        $gpt_test_success = get_transient('cdelu_gpt_test_success');
        
        include CDELU_PLUGIN_DIR . 'templates/settings-page.php';
    }
    
    /**
     * Render: Página de Registros
     */
    public function render_logs_page() {
        global $wpdb;
        
        $table = $wpdb->prefix . 'cdelu_logs';
        $paged = isset($_GET['paged']) ? absint($_GET['paged']) : 1;
        $per_page = 20;
        $offset = ($paged - 1) * $per_page;
        
        $logs = $wpdb->get_results("
            SELECT * FROM $table 
            ORDER BY created_at DESC 
            LIMIT $offset, $per_page
        ");
        
        $total = $wpdb->get_var("SELECT COUNT(*) FROM $table");
        $total_pages = ceil($total / $per_page);
        
        include CDELU_PLUGIN_DIR . 'templates/logs-page.php';
    }
    
    /**
     * Render: Página de Video Logs
     */
    public function render_video_logs_page() {
        if (!current_user_can('manage_options')) {
            wp_die('No autorizado');
        }

        // Action to reset a post
        if (isset($_POST['reset_post_id']) && wp_verify_nonce($_POST['cdelu_video_reset_nonce'], 'cdelu_video_reset_action')) {
            $reset_id = intval($_POST['reset_post_id']);
            delete_post_meta($reset_id, '_cdelu_video_processed');
            echo '<div class="notice notice-success is-dismissible"><p>Post #' . esc_html($reset_id) . ' reseteado con éxito. El bot lo volverá a detectar.</p></div>';
        }

        $paged = isset($_GET['paged']) ? max(1, intval($_GET['paged'])) : 1;
        $posts_per_page = 10;
        
        $args = [
            'post_type' => 'cdelu-ar',
            'post_status' => 'publish',
            'posts_per_page' => $posts_per_page,
            'paged' => $paged,
            'orderby' => 'date',
            'order' => 'DESC',
        ];
        
        $filter = isset($_GET['tab']) ? sanitize_text_field($_GET['tab']) : 'all';
        if ($filter === 'processed') {
            $args['meta_query'] = [
                [
                    'key' => '_cdelu_video_processed',
                    'value' => '1',
                    'compare' => '='
                ]
            ];
        } elseif ($filter === 'pending') {
            $args['meta_query'] = [
                [
                    'key' => '_cdelu_video_processed',
                    'compare' => 'NOT EXISTS'
                ]
            ];
        }

        $query = new WP_Query($args);
        $posts = $query->posts;
        $total_pages = $query->max_num_pages;
        $current_page = $paged;
        
        include CDELU_PLUGIN_DIR . 'templates/video-logs-page.php';
    }
    
    /**
     * Agregar metabox para republicación rápida
     */
    public function add_meta_boxes() {
        add_meta_box(
            'cdelu_republish_box',
            __('Cdelu Republisher', 'cdelu-republisher'),
            [$this, 'render_republish_metabox'],
            'post',
            'side',
            'high'
        );
    }
    
    /**
     * Render: Metabox de republicación
     */
    public function render_republish_metabox($post) {
        wp_nonce_field('cdelu_republish_nonce', 'cdelu_nonce');
        
        // Verificar duplicados
        $duplicates = $this->duplicate_detector->find_potential_duplicates($post->ID);
        
        include CDELU_PLUGIN_DIR . 'templates/republish-metabox.php';
    }
    
    /**
     * Agregar columnas personalizadas
     */
    public function add_posts_columns($columns) {
        $columns['cdelu_republish'] = __('Cdelu', 'cdelu-republisher');
        return $columns;
    }
    
    /**
     * Render: Columnas personalizadas
     */
    public function render_posts_column($column, $post_id) {
        if ($column === 'cdelu_republish') {
            $republished = get_post_meta($post_id, 'cdelu_republished', true);
            
            if ($republished === 'skipped') {
                echo '<span style="color: orange;">⊘ Ignorado</span>';
            } elseif ($republished) {
                echo '<span style="color: green;">✓ Republicado</span>';
            } else {
                echo '<span style="color: gray;">○ Pendiente</span>';
            }
        }
    }
}
