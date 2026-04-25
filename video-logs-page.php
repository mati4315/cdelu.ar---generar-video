<div class="wrap cdelu-video-logs">
    <h1><?php esc_html_e('Video Logs - Posts', 'cdelu-republisher'); ?></h1>
    
    <?php
    $view_mode = isset($_GET['view']) ? sanitize_text_field($_GET['view']) : 'grid';
    $base_url = remove_query_arg('view');
    ?>

    <div class="cdelu-top-bar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 class="nav-tab-wrapper" style="margin-bottom: 0; border-bottom: none; display: inline-flex;">
            <a href="<?php echo esc_url(add_query_arg('tab', 'all', $base_url)); ?>" class="nav-tab <?php echo ($filter === 'all' || !$filter) ? 'nav-tab-active' : ''; ?>">Todos</a>
            <a href="<?php echo esc_url(add_query_arg('tab', 'processed', $base_url)); ?>" class="nav-tab <?php echo ($filter === 'processed') ? 'nav-tab-active' : ''; ?>">Generados</a>
            <a href="<?php echo esc_url(add_query_arg('tab', 'pending', $base_url)); ?>" class="nav-tab <?php echo ($filter === 'pending') ? 'nav-tab-active' : ''; ?>">Pendientes</a>
        </h2>

        <div class="cdelu-view-controls">
            <a href="<?php echo esc_url(add_query_arg('view', 'grid')); ?>" class="button <?php echo $view_mode !== 'minimal' ? 'button-primary' : ''; ?>">
                <span class="dashicons dashicons-grid-view" style="margin-top: 3px;"></span>
            </a>
            <a href="<?php echo esc_url(add_query_arg('view', 'minimal')); ?>" class="button <?php echo $view_mode === 'minimal' ? 'button-primary' : ''; ?>">
                <span class="dashicons dashicons-list-view" style="margin-top: 3px;"></span>
            </a>
        </div>
    </div>

    <div class="cdelu-video-results <?php echo $view_mode === 'minimal' ? 'view-minimal' : 'view-grid'; ?>">
        <?php if (!empty($posts)) : ?>
            
            <?php if ($view_mode === 'minimal') : ?>
                <!-- VISTA MINIMALISTA (TABLA WP NATIVA) -->
                <div class="table-responsive-wrapper" style="overflow-x: auto; width: 100%;">
                    <table class="wp-list-table widefat fixed striped table-view-list" style="margin-top: 10px; min-width: 600px;">
                        <thead>
                            <tr>
                                <th width="60">ID</th>
                                <th>Título</th>
                                <th width="120">Fecha</th>
                                <th width="100">Estado</th>
                                <th width="110">Acciones</th>
                            </tr>
                        </thead>
                    <tbody>
                        <?php foreach ($posts as $post) : 
                            $processed = get_post_meta($post->ID, '_cdelu_video_processed', true);
                        ?>
                        <tr>
                            <td>#<?php echo esc_html($post->ID); ?></td>
                            <td><strong><a href="<?php echo esc_url(get_edit_post_link($post->ID)); ?>" target="_blank"><?php echo esc_html($post->post_title); ?></a></strong></td>
                            <td><?php echo esc_html(get_the_date('', $post->ID)); ?></td>
                            <td>
                                <?php if ($processed) : ?>
                                    <span style="color: #278130; font-weight: bold;">Generado</span>
                                <?php else : ?>
                                    <span style="color: #9b7200; font-weight: bold;">Pendiente</span>
                                <?php endif; ?>
                            </td>
                            <td>
                                <?php if ($processed) : ?>
                                    <form method="post" style="display:inline-block;">
                                        <?php wp_nonce_field('cdelu_video_reset_action', 'cdelu_video_reset_nonce'); ?>
                                        <input type="hidden" name="reset_post_id" value="<?php echo esc_attr($post->ID); ?>">
                                        <button type="submit" class="button button-small reset-btn" onclick="return confirm('¿Estás seguro de resetear este post?');">Resetear</button>
                                    </form>
                                <?php endif; ?>
                            </td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
                </div>
            <?php else : ?>
                <!-- VISTA CUADRÍCULA (CARDS) -->
                <div class="cdelu-video-cards">
                    <?php foreach ($posts as $post) : 
                        $processed = get_post_meta($post->ID, '_cdelu_video_processed', true);
                        if ($processed) {
                            $status_class = 'status-generated';
                            $status_text = 'Video Generado';
                        } else {
                            $status_class = 'status-pending';
                            $status_text = 'Pendiente';
                        }
                    ?>
                        <div class="cdelu-video-card <?php echo $status_class; ?>">
                            <div class="card-header">
                                <span class="post-id">#<?php echo esc_html($post->ID); ?></span>
                                <span class="status-badge"><?php echo esc_html($status_text); ?></span>
                            </div>
                            <div class="card-body">
                                <h3><?php echo esc_html($post->post_title); ?></h3>
                                <p class="post-date"><?php echo esc_html(get_the_date('', $post->ID)); ?></p>
                                
                                <div class="card-actions">
                                    <a href="<?php echo esc_url(get_edit_post_link($post->ID)); ?>" target="_blank" class="button button-secondary button-small">Editar Post</a>
                                    
                                    <?php if ($processed) : ?>
                                        <form method="post" style="display:inline-block; margin-left:10px;">
                                            <?php wp_nonce_field('cdelu_video_reset_action', 'cdelu_video_reset_nonce'); ?>
                                            <input type="hidden" name="reset_post_id" value="<?php echo esc_attr($post->ID); ?>">
                                            <button type="submit" class="button button-secondary button-small reset-btn" onclick="return confirm('¿Estás seguro de resetear este post? El bot lo volverá a detectar.');">Resetear</button>
                                        </form>
                                    <?php endif; ?>
                                </div>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>


        <?php else : ?>
            <div class="notice notice-info"><p>No se encontraron posts para este filtro.</p></div>
        <?php endif; ?>
    </div>

    <?php if ($total_pages > 1) : ?>
        <div class="cdelu-pagination">
            <?php
            echo paginate_links([
                'base' => add_query_arg('paged', '%#%'),
                'format' => '',
                'prev_text' => __('&laquo; Anterior'),
                'next_text' => __('Siguiente &raquo;'),
                'total' => $total_pages,
                'current' => $current_page
            ]);
            ?>
        </div>
    <?php endif; ?>

    <style>
        .cdelu-video-cards {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .cdelu-video-card {
            background: #fff;
            border: 1px solid #ccd0d4;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.04);
            padding: 15px;
            display: flex;
            flex-direction: column;
            transition: transform 0.2s;
        }
        .cdelu-video-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.08);
        }
        .cdelu-video-card.status-generated {
            border-left: 4px solid #46b450;
        }
        .cdelu-video-card.status-pending {
            border-left: 4px solid #ffb900;
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 1px solid #f0f0f1;
            padding-bottom: 10px;
        }
        .post-id {
            font-weight: 600;
            color: #555;
            background: #f0f0f1;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 12px;
        }
        .status-badge {
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 12px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .status-generated .status-badge {
            background: #e5f5e6;
            color: #278130;
        }
        .status-pending .status-badge {
            background: #fff8e5;
            color: #9b7200;
        }
        .card-body {
            flex-grow: 1;
            display: flex;
            flex-direction: column;
        }
        .card-body h3 {
            margin: 0 0 10px 0;
            font-size: 16px;
            line-height: 1.4;
            color: #1d2327;
        }
        .post-date {
            color: #646970;
            font-size: 13px;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
        }
        .post-date::before {
            content: "\\f111";
            font-family: dashicons;
            margin-right: 5px;
            font-size: 14px;
        }
        .card-actions {
            margin-top: auto;
            border-top: 1px solid #f0f0f1;
            padding-top: 15px;
            display: flex;
            align-items: center;
        }
        .cdelu-pagination {
            margin-top: 30px;
            display: flex;
            gap: 5px;
            justify-content: center;
            padding: 20px 0;
        }
        .cdelu-pagination .page-numbers {
            display: inline-block;
            padding: 8px 14px;
            background: #fff;
            border: 1px solid #ccd0d4;
            text-decoration: none;
            color: #2271b1;
            border-radius: 4px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .cdelu-pagination .page-numbers:hover {
            border-color: #2271b1;
            color: #135e96;
            background: #f6f7f7;
        }
        .cdelu-pagination .page-numbers.current {
            background: #2271b1;
            color: #fff;
            border-color: #2271b1;
        }
        .reset-btn {
            color: #d63638 !important;
            border-color: #d63638 !important;
            background: transparent !important;
        }
        .reset-btn:hover {
            background: #d63638 !important;
            color: #fff !important;
            border-color: #d63638 !important;
        }
        @media (max-width: 600px) {
            .cdelu-video-cards {
                grid-template-columns: 1fr;
            }
            .cdelu-top-bar {
                flex-direction: column;
                align-items: flex-start !important;
                gap: 15px;
            }
            .nav-tab-wrapper {
                flex-wrap: nowrap;
                overflow-x: auto;
                -webkit-overflow-scrolling: touch;
                width: 100%;
            }
            .nav-tab {
                flex: 0 0 auto;
                border: 1px solid #ccc;
                border-radius: 4px;
                margin-right: 5px;
            }
        }
    </style>
</div>
