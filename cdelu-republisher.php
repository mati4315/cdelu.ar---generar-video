<?php
/**
 * Plugin Name: Cdelu Republisher
 * Plugin URI: https://cdelu.ar/cdelu-republisher
 * Description: Republicador inteligente de posts al custom post type "Cdelu-ar" con detección de duplicados y resumidor con ChatGPT
 * Version: 1.0.0
 * Author: Matias Moreira
 * Author URI: https://cdelu.ar
 * License: GPL v2 or later
 * Text Domain: cdelu-republisher
 * Domain Path: /languages
 * Requires at least: 5.0
 * Requires PHP: 7.4
 * Tested up to: 6.9
 */

defined('ABSPATH') || exit;

// Constantes del plugin
define('CDELU_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('CDELU_PLUGIN_URL', plugin_dir_url(__FILE__));
define('CDELU_PLUGIN_VERSION', '1.0.0');

// Incluir archivos
require_once CDELU_PLUGIN_DIR . 'includes/class-cdelu-post-type.php';
require_once CDELU_PLUGIN_DIR . 'includes/class-cdelu-admin.php';
require_once CDELU_PLUGIN_DIR . 'includes/class-cdelu-republisher.php';
require_once CDELU_PLUGIN_DIR . 'includes/class-cdelu-duplicate-detector.php';
require_once CDELU_PLUGIN_DIR . 'includes/class-cdelu-gpt-summarizer.php';

/**
 * Inicializador del plugin
 */
class Cdelu_Republisher_Plugin {
    
    private static $instance = null;
    
    public static function get_instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        $this->init();
    }
    
    private function init() {
        // Instalación/Desinstalación
        register_activation_hook(__FILE__, [__CLASS__, 'activate']);
        register_deactivation_hook(__FILE__, [__CLASS__, 'deactivate']);
        
        // Inicializar clases principales
        add_action('init', [$this, 'initialize_classes'], 10);
        
        // Cargar estilos y scripts
        add_action('admin_enqueue_scripts', [$this, 'enqueue_admin_assets']);
        
        // Registrar intervalos cron
        add_filter('cron_schedules', [$this, 'add_cron_intervals']);
    }
    
    public function add_cron_intervals($schedules) {
        $intervals = [2, 4, 6, 8, 12];
        foreach ($intervals as $hrs) {
            $key = "cdelu_every_{$hrs}_hours";
            if (!isset($schedules[$key])) {
                $schedules[$key] = [
                    'interval' => $hrs * HOUR_IN_SECONDS,
                    'display'  => sprintf(__('Cada %d Horas (Cdelu)', 'cdelu-republisher'), $hrs)
                ];
            }
        }
        return $schedules;
    }
    
    public function initialize_classes() {
        new Cdelu_Post_Type();
        new Cdelu_Admin();
        new Cdelu_Republisher();
        new Cdelu_Duplicate_Detector();
        new Cdelu_GPT_Summarizer();
    }
    
    public function enqueue_admin_assets($hook) {
        if (strpos($hook, 'cdelu') !== false) {
            wp_enqueue_style(
                'cdelu-admin-style',
                CDELU_PLUGIN_URL . 'assets/css/admin.css',
                [],
                CDELU_PLUGIN_VERSION
            );
            
            wp_enqueue_script(
                'cdelu-admin-script',
                CDELU_PLUGIN_URL . 'assets/js/admin.js',
                ['jquery'],
                CDELU_PLUGIN_VERSION,
                true
            );
            
            wp_localize_script('cdelu-admin-script', 'cdeluAjax', [
                'ajaxurl' => admin_url('admin-ajax.php'),
                'nonce' => wp_create_nonce('cdelu_nonce'),
            ]);
        }
    }
    
    public static function activate() {
        // Crear tabla de log
        global $wpdb;
        $charset_collate = $wpdb->get_charset_collate();
        $table_name = $wpdb->prefix . 'cdelu_logs';
        
        $sql = "CREATE TABLE IF NOT EXISTS $table_name (
            id mediumint(9) NOT NULL AUTO_INCREMENT,
            post_original_id mediumint(9) NOT NULL,
            post_cdelu_id mediumint(9),
            action VARCHAR(50) NOT NULL,
            status VARCHAR(20) NOT NULL,
            message LONGTEXT,
            similarity_score FLOAT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY post_original_id (post_original_id),
            KEY created_at (created_at)
        ) $charset_collate;";
        
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);
        
        // Guardar versión
        update_option('cdelu_plugin_version', CDELU_PLUGIN_VERSION);
        
        $default_options = [
            'cdelu_gpt_api_key' => '',
            'cdelu_gpt_model' => 'gpt-4o-mini',
            'cdelu_similarity_threshold' => 85,
            'cdelu_enable_auto_summary' => 1,
            'cdelu_enable_duplicate_check' => 1,
            'cdelu_check_period_days' => 2,
            'cdelu_summary_length' => 'medium',
            'cdelu_auto_republish_mode' => 'disabled',
            'cdelu_auto_republish_interval' => 4,
        ];
        
        foreach ($default_options as $key => $value) {
            if (!get_option($key)) {
                update_option($key, $value);
            }
        }
    }
    
    public static function deactivate() {
        // Limpiar scheduled hooks
        wp_clear_scheduled_hook('cdelu_auto_republish_hook');
    }
}

// Iniciar el plugin
Cdelu_Republisher_Plugin::get_instance();
