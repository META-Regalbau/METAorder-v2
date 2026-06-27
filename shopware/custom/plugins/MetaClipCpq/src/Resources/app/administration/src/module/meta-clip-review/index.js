import './page/meta-clip-review-list';
import './page/meta-clip-review-detail';
import deDE from './snippet/de-DE.json';
import enGB from './snippet/en-GB.json';

const { Module } = Shopware;

Module.register('meta-clip-review', {
    type: 'plugin',
    name: 'META Clip Review Queue',
    title: 'meta-clip-review.general.mainMenuItemGeneral',
    description: 'meta-clip-review.general.descriptionTextModule',
    color: '#1f5cff',
    icon: 'regular-clipboard',
    snippets: {
        'de-DE': deDE,
        'en-GB': enGB,
    },
    routes: {
        list: {
            component: 'meta-clip-review-list',
            path: 'list',
        },
        detail: {
            component: 'meta-clip-review-detail',
            path: 'detail/:id',
            meta: {
                parentPath: 'meta.clip.review.list',
            },
        },
    },
    defaultSearchConfiguration: {
        _searchable: false,
    },
    settingsItem: {
        privilege: 'meta_clip.review.read',
    },
    privileges: {
        read: {
            privileges: ['meta_clip.review.read'],
            dependencies: [],
        },
        assign: {
            privileges: ['meta_clip.review.assign'],
            dependencies: ['read'],
        },
        approve: {
            privileges: ['meta_clip.review.approve'],
            dependencies: ['assign'],
        },
    },
    navigation: [{
        id: 'meta-clip-review-menu',
        label: 'meta-clip-review.general.mainMenuItemGeneral',
        color: '#1f5cff',
        path: 'meta.clip.review.list',
        icon: 'regular-clipboard',
        parent: 'sw-order',
        position: 110,
        privilege: 'meta_clip.review.read',
    }],
});
