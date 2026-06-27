<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Review\Api;

use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Meta\ClipCpq\Core\Review\ReviewQueueService;
use Shopware\Core\Framework\Context;
use Shopware\Core\Framework\Routing\RoutingException;
use Shopware\Core\Framework\Validation\DataBag\RequestDataBag;
use Shopware\Core\System\SalesChannel\Context\AdminApiSource;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

#[Route(defaults: ['_routeScope' => ['api']])]
class ReviewQueueController extends AbstractController
{
    public function __construct(private readonly ReviewQueueService $reviewQueueService)
    {
    }

    #[Route(
        path: '/api/meta-clip/review-queue/pending',
        name: 'api.meta_clip.review_queue.pending',
        methods: ['GET'],
        defaults: ['_acl' => ['meta_clip.review.read']]
    )]
    public function listPending(Context $context): JsonResponse
    {
        $items = array_map(fn ($entity) => $this->serializeConfiguration($entity), $this->reviewQueueService->listPending($context));

        return new JsonResponse(['data' => $items]);
    }

    #[Route(
        path: '/api/meta-clip/review-queue/assigned',
        name: 'api.meta_clip.review_queue.assigned',
        methods: ['GET'],
        defaults: ['_acl' => ['meta_clip.review.read']]
    )]
    public function listAssigned(Context $context): JsonResponse
    {
        $userId = $this->resolveAdminUserId($context);
        $items = array_map(fn ($entity) => $this->serializeConfiguration($entity), $this->reviewQueueService->listAssigned($userId, $context));

        return new JsonResponse(['data' => $items]);
    }

    #[Route(
        path: '/api/meta-clip/review-queue/{configurationId}/assign',
        name: 'api.meta_clip.review_queue.assign',
        methods: ['POST'],
        defaults: ['_acl' => ['meta_clip.review.assign']]
    )]
    public function assign(string $configurationId, RequestDataBag $dataBag, Context $context): JsonResponse
    {
        $actorUserId = $this->resolveAdminUserId($context);
        $assignedTo = (string) $dataBag->get('assignedTo');

        if ($assignedTo === '') {
            throw RoutingException::missingRequestParameter('assignedTo');
        }

        $entity = $this->reviewQueueService->assign($configurationId, $actorUserId, $assignedTo, $context);

        return new JsonResponse(['data' => $this->serializeConfiguration($entity)]);
    }

    #[Route(
        path: '/api/meta-clip/review-queue/{configurationId}/approve',
        name: 'api.meta_clip.review_queue.approve',
        methods: ['POST'],
        defaults: ['_acl' => ['meta_clip.review.approve']]
    )]
    public function approve(string $configurationId, Request $request, Context $context): JsonResponse
    {
        $notes = $request->toArray()['notes'] ?? null;
        $entity = $this->reviewQueueService->approve($configurationId, $this->resolveAdminUserId($context), is_string($notes) ? $notes : null, $context);

        return new JsonResponse(['data' => $this->serializeConfiguration($entity)]);
    }

    #[Route(
        path: '/api/meta-clip/review-queue/{configurationId}/reject',
        name: 'api.meta_clip.review_queue.reject',
        methods: ['POST'],
        defaults: ['_acl' => ['meta_clip.review.approve']]
    )]
    public function reject(string $configurationId, Request $request, Context $context): JsonResponse
    {
        $notes = $request->toArray()['notes'] ?? null;
        $entity = $this->reviewQueueService->reject($configurationId, $this->resolveAdminUserId($context), is_string($notes) ? $notes : null, $context);

        return new JsonResponse(['data' => $this->serializeConfiguration($entity)]);
    }

    #[Route(
        path: '/api/meta-clip/review-queue/{configurationId}/request-customer-contact',
        name: 'api.meta_clip.review_queue.request_customer_contact',
        methods: ['POST'],
        defaults: ['_acl' => ['meta_clip.review.approve']]
    )]
    public function requestCustomerContact(string $configurationId, Request $request, Context $context): JsonResponse
    {
        $notes = $request->toArray()['notes'] ?? null;
        $entity = $this->reviewQueueService->requestCustomerContact($configurationId, $this->resolveAdminUserId($context), is_string($notes) ? $notes : null, $context);

        return new JsonResponse(['data' => $this->serializeConfiguration($entity)]);
    }

    private function resolveAdminUserId(Context $context): string
    {
        $source = $context->getSource();
        if (!$source instanceof AdminApiSource) {
            throw new \RuntimeException('Review queue actions are only available in admin API context.');
        }

        return $source->getUserId();
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeConfiguration(ConfigurationEntity $entity): array
    {
        $reviewLogs = [];
        $collection = $entity->getReviewLogs();
        if ($collection !== null) {
            foreach ($collection as $log) {
                $reviewLogs[] = [
                    'id' => $log->getId(),
                    'action' => $log->getAction(),
                    'fromStatus' => $log->getFromStatus(),
                    'toStatus' => $log->getToStatus(),
                    'createdAt' => $log->getCreatedAt()?->format(\DateTimeInterface::ATOM),
                ];
            }
        }

        return [
            'id' => $entity->getId(),
            'name' => $entity->getName(),
            'validationStatus' => $entity->getValidationStatus(),
            'assignedTo' => $entity->getAssignedTo(),
            'assignedAt' => $entity->getAssignedAt()?->format(\DateTimeInterface::ATOM),
            'outcome' => $entity->getOutcome(),
            'notes' => $entity->getNotes(),
            'configData' => $entity->getConfigData(),
            'reviewLogs' => $reviewLogs,
        ];
    }
}
