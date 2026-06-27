import template from './meta-clip-review-detail.html.twig';

const { Component } = Shopware;
const { Criteria } = Shopware.Data;

Component.register('meta-clip-review-detail', {
    template,

    inject: ['repositoryFactory'],

    data() {
        return {
            isLoading: false,
            entity: null,
            notes: '',
            assignedTo: '',
        };
    },

    computed: {
        configurationRepository() {
            return this.repositoryFactory.create('meta_clip_configuration');
        },
    },

    created() {
        this.loadDetail();
    },

    methods: {
        async loadDetail() {
            this.isLoading = true;

            try {
                const criteria = new Criteria(1, 1);
                criteria.addAssociation('reviewLogs');
                this.entity = await this.configurationRepository.get(this.$route.params.id, Shopware.Context.api, criteria);
            } catch (error) {
                this.createNotificationError({
                    title: this.$tc('global.default.error'),
                    message: error.message,
                });
            } finally {
                this.isLoading = false;
            }
        },

        async triggerAction(action) {
            this.isLoading = true;

            try {
                // TODO verify (Shopware 6.6.x): endpoint naming and payload schema for admin action bridge.
                await Shopware.Service('syncService').httpClient.post(
                    `/api/meta-clip/review-queue/${this.entity.id}/${action}`,
                    { notes: this.notes },
                );
                await this.loadDetail();
            } catch (error) {
                this.createNotificationError({
                    title: this.$tc('global.default.error'),
                    message: error.message,
                });
            } finally {
                this.isLoading = false;
            }
        },

        async triggerAssign() {
            if (!this.assignedTo) {
                return;
            }

            this.isLoading = true;
            try {
                await Shopware.Service('syncService').httpClient.post(
                    `/api/meta-clip/review-queue/${this.entity.id}/assign`,
                    { assignedTo: this.assignedTo },
                );
                await this.loadDetail();
            } catch (error) {
                this.createNotificationError({
                    title: this.$tc('global.default.error'),
                    message: error.message,
                });
            } finally {
                this.isLoading = false;
            }
        },
    },
});
