import template from './meta-clip-review-list.html.twig';

const { Component } = Shopware;

Component.register('meta-clip-review-list', {
    template,

    inject: ['repositoryFactory'],

    data() {
        return {
            isLoading: false,
            pendingItems: [],
            assignedItems: [],
        };
    },

    computed: {
        configurationRepository() {
            return this.repositoryFactory.create('meta_clip_configuration');
        },
    },

    created() {
        this.loadQueue();
    },

    methods: {
        async loadQueue() {
            this.isLoading = true;

            try {
                // TODO verify (Shopware 6.6.x): keep syncService/httpClient contract in final admin build.
                const [pending, assigned] = await Promise.all([
                    Shopware.Service('syncService').httpClient.get('/api/meta-clip/review-queue/pending'),
                    Shopware.Service('syncService').httpClient.get('/api/meta-clip/review-queue/assigned'),
                ]);

                this.pendingItems = pending.data.data ?? [];
                this.assignedItems = assigned.data.data ?? [];
            } catch (error) {
                this.createNotificationError({
                    title: this.$tc('global.default.error'),
                    message: error.message,
                });
            } finally {
                this.isLoading = false;
            }
        },

        openDetail(item) {
            this.$router.push({ name: 'meta.clip.review.detail', params: { id: item.id } });
        },
    },
});
