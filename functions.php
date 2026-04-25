<?php
/**
 * Twenty Twenty-Five functions and definitions.
 *
 * @link https://developer.wordpress.org/themes/basics/theme-functions/
 *
 * @package WordPress
 * @subpackage Twenty_Twenty_Five
 * @since Twenty Twenty-Five 1.0
 */

// Adds theme support for post formats.
if ( ! function_exists( 'twentytwentyfive_post_format_setup' ) ) :
	/**
	 * Adds theme support for post formats.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_post_format_setup() {
		add_theme_support( 'post-formats', array( 'aside', 'audio', 'chat', 'gallery', 'image', 'link', 'quote', 'status', 'video' ) );
	}
endif;
add_action( 'after_setup_theme', 'twentytwentyfive_post_format_setup' );

// Enqueues editor-style.css in the editors.
if ( ! function_exists( 'twentytwentyfive_editor_style' ) ) :
	/**
	 * Enqueues editor-style.css in the editors.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_editor_style() {
		add_editor_style( 'assets/css/editor-style.css' );
	}
endif;
add_action( 'after_setup_theme', 'twentytwentyfive_editor_style' );

// Enqueues the theme stylesheet on the front.
if ( ! function_exists( 'twentytwentyfive_enqueue_styles' ) ) :
	/**
	 * Enqueues the theme stylesheet on the front.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_enqueue_styles() {
		$suffix = SCRIPT_DEBUG ? '' : '.min';
		$src    = 'style' . $suffix . '.css';

		wp_enqueue_style(
			'twentytwentyfive-style',
			get_parent_theme_file_uri( $src ),
			array(),
			wp_get_theme()->get( 'Version' )
		);
		wp_style_add_data(
			'twentytwentyfive-style',
			'path',
			get_parent_theme_file_path( $src )
		);
	}
endif;
add_action( 'wp_enqueue_scripts', 'twentytwentyfive_enqueue_styles' );

// Registers custom block styles.
if ( ! function_exists( 'twentytwentyfive_block_styles' ) ) :
	/**
	 * Registers custom block styles.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_block_styles() {
		register_block_style(
			'core/list',
			array(
				'name'         => 'checkmark-list',
				'label'        => __( 'Checkmark', 'twentytwentyfive' ),
				'inline_style' => '
				ul.is-style-checkmark-list {
					list-style-type: "\2713";
				}

				ul.is-style-checkmark-list li {
					padding-inline-start: 1ch;
				}',
			)
		);
	}
endif;
add_action( 'init', 'twentytwentyfive_block_styles' );

// Registers pattern categories.
if ( ! function_exists( 'twentytwentyfive_pattern_categories' ) ) :
	/**
	 * Registers pattern categories.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_pattern_categories() {

		register_block_pattern_category(
			'twentytwentyfive_page',
			array(
				'label'       => __( 'Pages', 'twentytwentyfive' ),
				'description' => __( 'A collection of full page layouts.', 'twentytwentyfive' ),
			)
		);

		register_block_pattern_category(
			'twentytwentyfive_post-format',
			array(
				'label'       => __( 'Post formats', 'twentytwentyfive' ),
				'description' => __( 'A collection of post format patterns.', 'twentytwentyfive' ),
			)
		);
	}
endif;
add_action( 'init', 'twentytwentyfive_pattern_categories' );

// Registers block binding sources.
if ( ! function_exists( 'twentytwentyfive_register_block_bindings' ) ) :
	/**
	 * Registers the post format block binding source.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return void
	 */
	function twentytwentyfive_register_block_bindings() {
		register_block_bindings_source(
			'twentytwentyfive/format',
			array(
				'label'              => _x( 'Post format name', 'Label for the block binding placeholder in the editor', 'twentytwentyfive' ),
				'get_value_callback' => 'twentytwentyfive_format_binding',
			)
		);
	}
endif;
add_action( 'init', 'twentytwentyfive_register_block_bindings' );

// Registers block binding callback function for the post format name.
if ( ! function_exists( 'twentytwentyfive_format_binding' ) ) :
	/**
	 * Callback function for the post format name block binding source.
	 *
	 * @since Twenty Twenty-Five 1.0
	 *
	 * @return string|void Post format name, or nothing if the format is 'standard'.
	 */
	function twentytwentyfive_format_binding() {
		$post_format_slug = get_post_format();

		if ( $post_format_slug && 'standard' !== $post_format_slug ) {
			return get_post_format_string( $post_format_slug );
		}
	}
endif;

// Registrar endpoint para que Node.js consulte posts de cdelu-ar no procesados
add_action('rest_api_init', 'register_cdelu_video_endpoint');
function register_cdelu_video_endpoint() {
    register_rest_route('cdelu-video/v1', '/posts', array(
        'methods' => 'GET',
        'callback' => 'get_unprocessed_cdelu_ar_posts',
        'permission_callback' => '__return_true', // Abierto para el bot (añade un token personalizado en produccion si deseas)
    ));
    register_rest_route('cdelu-video/v1', '/posts/(?P<id>\d+)/mark-processed', array(
        'methods' => 'POST',
        'callback' => 'mark_cdelu_ar_post_processed',
        'permission_callback' => '__return_true',
    ));
}

// Callback para obtener posts no procesados
function get_unprocessed_cdelu_ar_posts($request) {
    $args = array(
        'post_type' => 'cdelu-ar',
        'post_status' => 'publish',
        'meta_query' => array(
            array(
                'key' => '_cdelu_video_processed',
                'compare' => 'NOT EXISTS', // Solo posts no marcados como procesados
            ),
        ),
        'date_query' => array(
            array(
                'after' => '7 days ago', // Últimos 7 días
            ),
        ),
        'posts_per_page' => 50, // Límite para evitar sobrecarga del server
    );
    $posts = get_posts($args);
    $data = array();
    foreach ($posts as $post) {
        $thumbnail_id = get_post_thumbnail_id($post->ID);
        $image_url = $thumbnail_id ? wp_get_attachment_url($thumbnail_id) : '';
        $data[] = array(
            'id' => $post->ID,
            'titulo' => $post->post_title,
            'descripcion' => apply_filters('the_content', $post->post_content),
            'images' => array($image_url),
            'createdAt' => get_post_time('c', true, $post), // ISO 8601
            'category' => wp_get_post_categories($post->ID, array('fields' => 'names'))[0] ?? '',
            'tags' => wp_get_post_tags($post->ID, array('fields' => 'names')),
        );
    }
    return new WP_REST_Response($data, 200);
}

// Callback para marcar post como procesado
function mark_cdelu_ar_post_processed($request) {
    $post_id = $request->get_param('id');
    if (get_post_type($post_id) === 'cdelu-ar') {
        update_post_meta($post_id, '_cdelu_video_processed', '1');
        return new WP_REST_Response(array('success' => true), 200);
    }
    return new WP_REST_Response(array('error' => 'Post no encontrado o no es cdelu-ar'), 404);
}
