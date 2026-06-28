import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import WebhooksSettingsSection from "@/components/WebhooksSettingsSection";
import N8nSettingsSection from "@/components/N8nSettingsSection";
import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { DunningSettings, EmailInboundSettings, EmailOutboundSettings, EmailRoutingRule, EmailRoutingSettings, GoogleAdsSettings, GoogleAnalyticsSettings, M365Settings, ProformaNumberRangeSettings, TicketCategory, TicketPriority } from "@shared/schema";

type OfferStatusMapping = {
  draft: { id?: string | null; label: string };
  submitted: { id?: string | null; label: string };
  sent: { id?: string | null; label: string };
  approved: { id?: string | null; label: string };
  rejected: { id?: string | null; label: string };
};

type OfferStatusRecord = {
  id: string;
  label: string | null;
  draft: boolean | null;
  open: boolean | null;
  confirmed: boolean | null;
  declined: boolean | null;
};

type TenantInfo = {
  id: string;
  name: string;
};

type SemanticRankingSettings = {
  vectorWeight: number;
  textWeight: number;
  metadataWeight: number;
  feedbackWeight: number;
  metadataExactBoost: number;
  metadataPartialBoost: number;
  titleTokenBoost: number;
};

type AiPromptOverrides = {
  semanticSearchSystemAddon: string;
  faqSystemAddon: string;
};

type OfferConfigPdfTextsForm = {
  introTemplate: string;
  systemInfoTitle: string;
  systemInfoByKey: Record<string, string>;
  standardClosingTitle: string;
  standardClosing: string;
};

const OFFER_PDF_SYSTEM_KEYS = ["meta", "steck", "schraub", "_default"] as const;

type CommercialAgentForm = {
  enabled: boolean;
  autoCreateMinIntentConfidence: number;
  autoCreateMinMatchConfidence: number;
  autoCreateOffersEnabled: boolean;
  autoCreateOrdersEnabled: boolean;
  autoCreateSalesChannelId: string;
  documentLearningEnabled: boolean;
  subAgentsEnabled: boolean;
  exemplarsInPromptMax: number;
  webDomainVerifyEnabled: boolean;
  extractionRefinementSubAgentsEnabled: boolean;
  lineItemSixDigitGtinPrefixes: string[];
  customerMatchAutoMinConfidence: number;
  customerAutoCreateMinConfidence: number;
  minRankedEmailScoreForAutoCreate: number;
  signatureCompanyVisionEnabled: boolean;
};

const defaultCommercialAgentForm: CommercialAgentForm = {
  enabled: false,
  autoCreateMinIntentConfidence: 0.85,
  autoCreateMinMatchConfidence: 90,
  autoCreateOffersEnabled: true,
  autoCreateOrdersEnabled: false,
  autoCreateSalesChannelId: "",
  documentLearningEnabled: true,
  subAgentsEnabled: true,
  exemplarsInPromptMax: 5,
  webDomainVerifyEnabled: false,
  extractionRefinementSubAgentsEnabled: false,
  lineItemSixDigitGtinPrefixes: [],
  customerMatchAutoMinConfidence: 72,
  customerAutoCreateMinConfidence: 50,
  minRankedEmailScoreForAutoCreate: 12,
  signatureCompanyVisionEnabled: false,
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}


export default function SettingsPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [shopwareUrl, setShopwareUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [hasShopwareSecret, setHasShopwareSecret] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [aiEnabled, setAiEnabled] = useState(false);

  const [commercialAgentForm, setCommercialAgentForm] =
    useState<CommercialAgentForm>(defaultCommercialAgentForm);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [chatProvider, setChatProvider] = useState<"openai" | "anthropic">("openai");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [anthropicModel, setAnthropicModel] = useState("");
  const [openaiChatModel, setOpenaiChatModel] = useState("");
  const [rankingSettings, setRankingSettings] = useState<SemanticRankingSettings>({
    vectorWeight: 0.65,
    textWeight: 0.25,
    metadataWeight: 0.1,
    feedbackWeight: 0.12,
    metadataExactBoost: 0.15,
    metadataPartialBoost: 0.08,
    titleTokenBoost: 0.06,
  });
  const [promptOverrides, setPromptOverrides] = useState<AiPromptOverrides>({
    semanticSearchSystemAddon: "",
    faqSystemAddon: "",
  });
  const [offerStatusMapping, setOfferStatusMapping] = useState<OfferStatusMapping | null>(null);
  const [offerConfigPdfForm, setOfferConfigPdfForm] = useState<OfferConfigPdfTextsForm | null>(null);
  const [slaSettings, setSlaSettings] = useState({
    lowDays: 7,
    normalDays: 3,
    highDays: 2,
    urgentDays: 1,
  });
  const [emailInboundSettings, setEmailInboundSettings] = useState<EmailInboundSettings>({
    enabled: false,
    host: "",
    port: 993,
    secure: true,
    user: "",
    password: "",
    mailbox: "INBOX",
    pollIntervalSeconds: 60,
    markAsSeen: true,
    maxMessages: 25,
    allowAttachments: true,
  });
  const [emailOutboundSettings, setEmailOutboundSettings] = useState<EmailOutboundSettings>({
    enabled: false,
    host: "",
    port: 587,
    secure: false,
    user: "",
    password: "",
    fromAddress: "",
    fromName: "",
    replyTo: "",
    m365ConnectionId: "",
  });
  const [emailRoutingSettings, setEmailRoutingSettings] = useState<EmailRoutingSettings>({
    enabled: true,
    confidenceThreshold: 0.65,
    defaultCategory: "general",
    defaultPriority: "normal",
    defaultSkill: "",
    fallbackRules: [],
  });
  const [hasInboundPassword, setHasInboundPassword] = useState(false);
  const [hasOutboundPassword, setHasOutboundPassword] = useState(false);
  const [m365Settings, setM365Settings] = useState<M365Settings>({
    enabled: false,
    clientId: "",
    clientSecret: "",
    redirectUri: "https://example.com/api/auth/m365/callback",
    enableGraph: true,
    enableImapSmtp: true,
    authFlow: "auth_code",
  });
  const [hasM365Secret, setHasM365Secret] = useState(false);
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<{
    state: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    expiresAt: string;
    interval: number;
    message?: string;
  } | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<"idle" | "pending" | "connected" | "expired" | "denied" | "error">("idle");
  const [deviceError, setDeviceError] = useState<string>("");
  const [gaSettings, setGaSettings] = useState<GoogleAnalyticsSettings>({
    enabled: false,
    propertyIds: [],
    serviceAccountJson: "",
  });
  const [gaPropertyIdsInput, setGaPropertyIdsInput] = useState("");
  const [hasGaServiceAccount, setHasGaServiceAccount] = useState(false);
  const [adsSettings, setAdsSettings] = useState<GoogleAdsSettings>({
    enabled: false,
    customerIds: [],
    developerToken: "",
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    loginCustomerId: "",
  });
  const [adsCustomerIdsInput, setAdsCustomerIdsInput] = useState("");
  const [hasAdsDeveloperToken, setHasAdsDeveloperToken] = useState(false);
  const [hasAdsClientId, setHasAdsClientId] = useState(false);
  const [hasAdsClientSecret, setHasAdsClientSecret] = useState(false);
  const [hasAdsRefreshToken, setHasAdsRefreshToken] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [proformaNumberRange, setProformaNumberRange] = useState<ProformaNumberRangeSettings>({
    prefix: "PF-",
    nextNumber: 1,
    padding: 6,
  });
  const [dunningSettings, setDunningSettings] = useState<DunningSettings>({
    enabled: false,
    manualOnly: true,
    dueDateFieldKey: "invoiceDate",
    stageDays: [7, 14, 21],
    documentTypeTechnicalName: "dunning",
    emailSubjectTemplate: "Mahnung Stufe {{stage}} zu Bestellung {{orderNumber}}",
    emailBodyTemplate: "Guten Tag {{customerName}},\n\nunsere Rechnung ist seit {{dueDate}} faellig. Dies ist Mahnstufe {{stage}}.\n\nMit freundlichen Gruessen\nIhr Team",
    generatePdfInApp: true,
    savePdfToShop: false,
  });

  const { data: tenantData, isLoading: tenantLoading } = useQuery<{
    tenants: TenantInfo[];
    activeTenantId: string | null;
  }>({
    queryKey: ["/api/tenants"],
    queryFn: () => fetchJson("/api/tenants"),
    retry: false,
  });

  const tenantKey = tenantData?.activeTenantId || "none";

  // Fetch AI settings
  const { data: aiSettings, isLoading: aiSettingsLoading } = useQuery<{
    enabled: boolean;
    hasApiKey: boolean;
    hasAnthropicKey?: boolean;
    chatProvider?: "openai" | "anthropic";
    anthropicModel?: string;
    openaiChatModel?: string;
    mode?: string;
  }>({
    queryKey: ["/api/settings/ai", tenantKey],
    queryFn: () => fetchJson("/api/settings/ai"),
    retry: false,
  });

  const { data: semanticRankingData } = useQuery<{
    settings: SemanticRankingSettings;
    defaults: SemanticRankingSettings;
  }>({
    queryKey: ["/api/settings/semantic-ranking", tenantKey],
    queryFn: () => fetchJson("/api/settings/semantic-ranking"),
    retry: false,
  });

  const { data: promptOverridesData } = useQuery<{ settings: AiPromptOverrides }>({
    queryKey: ["/api/settings/ai-prompts", tenantKey],
    queryFn: () => fetchJson("/api/settings/ai-prompts"),
    retry: false,
  });

  const { data: commercialAgentData } = useQuery<{ settings: CommercialAgentForm }>({
    queryKey: ["/api/settings/commercial-agent", tenantKey],
    queryFn: () => fetchJson("/api/settings/commercial-agent"),
    retry: false,
  });

  const { data: commercialLearningStats } = useQuery<{ total: number }>({
    queryKey: ["/api/commercial-agent/learning-stats", tenantKey],
    queryFn: () => fetchJson("/api/commercial-agent/learning-stats"),
    retry: false,
    enabled: Boolean(tenantData?.activeTenantId),
  });

  const { data: shopwareSettings } = useQuery<{ shopwareUrl: string; apiKey: string; hasSecret: boolean }>({
    queryKey: ["/api/settings/shopware", tenantKey],
    queryFn: () => fetchJson("/api/settings/shopware"),
    retry: false,
  });

  const { data: proformaNumberRangeSettings } = useQuery<ProformaNumberRangeSettings>({
    queryKey: ["/api/settings/proforma-number-range", tenantKey],
    queryFn: () => fetchJson("/api/settings/proforma-number-range"),
    retry: false,
  });

  const { data: dunningSettingsData } = useQuery<DunningSettings>({
    queryKey: ["/api/settings/dunning", tenantKey],
    queryFn: () => fetchJson("/api/settings/dunning"),
    retry: false,
  });

  const { data: b2bStatusMappingData, isLoading: b2bStatusMappingLoading } = useQuery<{
    mapping: OfferStatusMapping;
    defaults: OfferStatusMapping;
  }>({
    queryKey: ["/api/settings/b2b-offer-status-mapping", tenantKey],
    queryFn: () => fetchJson("/api/settings/b2b-offer-status-mapping"),
    retry: false,
  });

  const { data: offerConfigPdfTextsData, isLoading: offerConfigPdfTextsLoading } = useQuery<{
    effective: OfferConfigPdfTextsForm;
    defaults: OfferConfigPdfTextsForm;
    stored: unknown;
  }>({
    queryKey: ["/api/settings/offer-config-pdf-texts", tenantKey],
    queryFn: () => fetchJson("/api/settings/offer-config-pdf-texts"),
    retry: false,
  });

  const { data: offerStatusesData, isLoading: offerStatusesLoading } = useQuery<{
    total: number;
    statuses: OfferStatusRecord[];
  }>({
    queryKey: ["/api/b2b/offer-statuses", tenantKey],
    queryFn: () => fetchJson("/api/b2b/offer-statuses"),
    retry: false,
  });

  const { data: slaSettingsData, isLoading: slaSettingsLoading } = useQuery<{
    lowDays: number;
    normalDays: number;
    highDays: number;
    urgentDays: number;
  }>({
    queryKey: ["/api/settings/ticket-sla", tenantKey],
    queryFn: () => fetchJson("/api/settings/ticket-sla"),
    retry: false,
  });

  const { data: inboundSettingsData, isLoading: inboundSettingsLoading } = useQuery<{
    settings: EmailInboundSettings;
    hasPassword: boolean;
  }>({
    queryKey: ["/api/settings/email-inbound", tenantKey],
    queryFn: () => fetchJson("/api/settings/email-inbound"),
    retry: false,
  });

  const { data: outboundSettingsData, isLoading: outboundSettingsLoading } = useQuery<{
    settings: EmailOutboundSettings;
    hasPassword: boolean;
  }>({
    queryKey: ["/api/settings/email-outbound", tenantKey],
    queryFn: () => fetchJson("/api/settings/email-outbound"),
    retry: false,
  });

  const { data: routingSettingsData, isLoading: routingSettingsLoading } = useQuery<EmailRoutingSettings>({
    queryKey: ["/api/settings/email-routing", tenantKey],
    queryFn: () => fetchJson("/api/settings/email-routing"),
    retry: false,
  });

  const { data: m365SettingsData, isLoading: m365SettingsLoading } = useQuery<M365Settings & { hasClientSecret?: boolean }>({
    queryKey: ["/api/settings/m365", tenantKey],
    queryFn: () => fetchJson("/api/settings/m365"),
    retry: false,
  });

  const { data: m365Connections = [] } = useQuery<Array<{
    id: string;
    tenantId: string;
    email: string;
    scopes: string[];
    createdAt: string;
  }>>({
    queryKey: ["/api/m365/connections", tenantKey],
    queryFn: () => fetchJson("/api/m365/connections"),
    retry: false,
  });

  const { data: gaSettingsData, isLoading: gaSettingsLoading } = useQuery<GoogleAnalyticsSettings & { hasServiceAccountJson?: boolean }>({
    queryKey: ["/api/settings/google-analytics", tenantKey],
    queryFn: () => fetchJson("/api/settings/google-analytics"),
    retry: false,
  });

  const { data: adsSettingsData, isLoading: adsSettingsLoading } = useQuery<GoogleAdsSettings & {
    hasDeveloperToken?: boolean;
    hasClientId?: boolean;
    hasClientSecret?: boolean;
    hasRefreshToken?: boolean;
  }>({
    queryKey: ["/api/settings/google-ads", tenantKey],
    queryFn: () => fetchJson("/api/settings/google-ads"),
    retry: false,
  });

  useEffect(() => {
    if (shopwareSettings) {
      setShopwareUrl(shopwareSettings.shopwareUrl || "");
      setApiKey(shopwareSettings.apiKey || "");
      setHasShopwareSecret(!!shopwareSettings.hasSecret);
      setApiSecret("");
    }
  }, [shopwareSettings]);

  useEffect(() => {
    if (proformaNumberRangeSettings) {
      setProformaNumberRange(proformaNumberRangeSettings);
    }
  }, [proformaNumberRangeSettings]);

  useEffect(() => {
    if (dunningSettingsData) {
      setDunningSettings({
        ...dunningSettingsData,
        generatePdfInApp: dunningSettingsData.generatePdfInApp ?? true,
        savePdfToShop: dunningSettingsData.savePdfToShop ?? false,
      });
    }
  }, [dunningSettingsData]);

  useEffect(() => {
    if (aiSettings) {
      setAiEnabled(aiSettings.enabled);
      setChatProvider(aiSettings.chatProvider === "anthropic" ? "anthropic" : "openai");
      setAnthropicModel(aiSettings.anthropicModel ?? "");
      setOpenaiChatModel(aiSettings.openaiChatModel ?? "");
    }
  }, [aiSettings]);

  useEffect(() => {
    if (commercialAgentData?.settings) {
      const s = commercialAgentData.settings;
      setCommercialAgentForm({
        ...defaultCommercialAgentForm,
        ...s,
        autoCreateSalesChannelId: s.autoCreateSalesChannelId || "",
        documentLearningEnabled: s.documentLearningEnabled ?? defaultCommercialAgentForm.documentLearningEnabled,
        subAgentsEnabled: s.subAgentsEnabled ?? defaultCommercialAgentForm.subAgentsEnabled,
        exemplarsInPromptMax:
          typeof s.exemplarsInPromptMax === "number"
            ? s.exemplarsInPromptMax
            : defaultCommercialAgentForm.exemplarsInPromptMax,
        webDomainVerifyEnabled:
          typeof s.webDomainVerifyEnabled === "boolean"
            ? s.webDomainVerifyEnabled
            : defaultCommercialAgentForm.webDomainVerifyEnabled,
        extractionRefinementSubAgentsEnabled:
          typeof s.extractionRefinementSubAgentsEnabled === "boolean"
            ? s.extractionRefinementSubAgentsEnabled
            : defaultCommercialAgentForm.extractionRefinementSubAgentsEnabled,
        lineItemSixDigitGtinPrefixes: Array.isArray(s.lineItemSixDigitGtinPrefixes)
          ? s.lineItemSixDigitGtinPrefixes.map((x) => String(x).trim()).filter(Boolean)
          : defaultCommercialAgentForm.lineItemSixDigitGtinPrefixes,
        customerMatchAutoMinConfidence:
          typeof s.customerMatchAutoMinConfidence === "number"
            ? s.customerMatchAutoMinConfidence
            : defaultCommercialAgentForm.customerMatchAutoMinConfidence,
        customerAutoCreateMinConfidence:
          typeof s.customerAutoCreateMinConfidence === "number"
            ? s.customerAutoCreateMinConfidence
            : defaultCommercialAgentForm.customerAutoCreateMinConfidence,
        minRankedEmailScoreForAutoCreate:
          typeof s.minRankedEmailScoreForAutoCreate === "number"
            ? s.minRankedEmailScoreForAutoCreate
            : defaultCommercialAgentForm.minRankedEmailScoreForAutoCreate,
        signatureCompanyVisionEnabled:
          typeof s.signatureCompanyVisionEnabled === "boolean"
            ? s.signatureCompanyVisionEnabled
            : defaultCommercialAgentForm.signatureCompanyVisionEnabled,
      });
    }
  }, [commercialAgentData]);

  useEffect(() => {
    if (semanticRankingData?.settings) {
      setRankingSettings(semanticRankingData.settings);
    }
  }, [semanticRankingData]);

  useEffect(() => {
    if (promptOverridesData?.settings) {
      setPromptOverrides(promptOverridesData.settings);
    }
  }, [promptOverridesData]);

  useEffect(() => {
    if (b2bStatusMappingData?.mapping) {
      setOfferStatusMapping(b2bStatusMappingData.mapping);
    }
  }, [b2bStatusMappingData]);

  useEffect(() => {
    if (offerConfigPdfTextsData?.effective) {
      const e = offerConfigPdfTextsData.effective;
      setOfferConfigPdfForm({
        introTemplate: e.introTemplate,
        systemInfoTitle: e.systemInfoTitle,
        systemInfoByKey: { ...e.systemInfoByKey },
        standardClosingTitle: e.standardClosingTitle,
        standardClosing: e.standardClosing,
      });
    }
  }, [offerConfigPdfTextsData]);

  useEffect(() => {
    if (slaSettingsData) {
      setSlaSettings(slaSettingsData);
    }
  }, [slaSettingsData]);

  useEffect(() => {
    if (inboundSettingsData?.settings) {
      setEmailInboundSettings(inboundSettingsData.settings);
      setHasInboundPassword(inboundSettingsData.hasPassword);
    }
  }, [inboundSettingsData]);

  useEffect(() => {
    if (outboundSettingsData?.settings) {
      setEmailOutboundSettings(outboundSettingsData.settings);
      setHasOutboundPassword(outboundSettingsData.hasPassword);
    }
  }, [outboundSettingsData]);

  useEffect(() => {
    if (routingSettingsData) {
      setEmailRoutingSettings(routingSettingsData);
    }
  }, [routingSettingsData]);

  useEffect(() => {
    if (m365SettingsData) {
      const { hasClientSecret, ...rest } = m365SettingsData;
      setM365Settings({
        ...rest,
        clientSecret: "",
        authFlow: rest.authFlow || "auth_code",
      });
      setHasM365Secret(Boolean(hasClientSecret));
    }
  }, [m365SettingsData]);

  useEffect(() => {
    if (gaSettingsData) {
      const { hasServiceAccountJson, ...rest } = gaSettingsData;
      setGaSettings({
        ...rest,
        serviceAccountJson: "",
      });
      setGaPropertyIdsInput(rest.propertyIds?.join(", ") || "");
      setHasGaServiceAccount(Boolean(hasServiceAccountJson));
    }
  }, [gaSettingsData]);

  useEffect(() => {
    if (adsSettingsData) {
      const {
        hasDeveloperToken,
        hasClientId,
        hasClientSecret,
        hasRefreshToken,
        ...rest
      } = adsSettingsData;
      setAdsSettings({
        ...rest,
        developerToken: "",
        clientId: "",
        clientSecret: "",
        refreshToken: "",
      });
      setAdsCustomerIdsInput(rest.customerIds?.join(", ") || "");
      setHasAdsDeveloperToken(Boolean(hasDeveloperToken));
      setHasAdsClientId(Boolean(hasClientId));
      setHasAdsClientSecret(Boolean(hasClientSecret));
      setHasAdsRefreshToken(Boolean(hasRefreshToken));
    }
  }, [adsSettingsData]);

  useEffect(() => {
    if (tenantData) {
      setSelectedTenantId(tenantData.activeTenantId || "");
    }
  }, [tenantData]);

  const saveCommercialAgentMutation = useMutation({
    mutationFn: async (data: CommercialAgentForm) => {
      const response = await apiRequest("POST", "/api/settings/commercial-agent", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/commercial-agent", tenantKey] });
      queryClient.invalidateQueries({ queryKey: ["/api/commercial-agent/learning-stats", tenantKey] });
      toast({
        title: t("settings.commercialAgent.saveSuccess"),
        description: t("settings.commercialAgent.saveSuccessDesc"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.commercialAgent.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveAiSettingsMutation = useMutation({
    mutationFn: async (data: {
      apiKey?: string;
      anthropicApiKey?: string;
      enabled: boolean;
      chatProvider: "openai" | "anthropic";
      anthropicModel: string;
      openaiChatModel: string;
    }) => {
      const response = await apiRequest("POST", "/api/settings/ai", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai", tenantKey] });
      toast({
        title: t('ai.settingsSaved'),
        description: t('ai.settingsSavedDesc'),
      });
      setOpenaiApiKey("");
      setAnthropicApiKey("");
    },
    onError: (error: Error) => {
      toast({
        title: t('ai.settingsFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveSemanticRankingMutation = useMutation({
    mutationFn: async (data: SemanticRankingSettings) => {
      const response = await apiRequest("POST", "/api/settings/semantic-ranking", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("settings.semanticRanking.saveSuccess"),
        description: t("settings.semanticRanking.saveSuccessDesc"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/semantic-ranking", tenantKey] });
    },
    onError: (error: any) => {
      toast({
        title: t("settings.semanticRanking.saveError"),
        description: error?.message || t("settings.semanticRanking.saveErrorDesc"),
        variant: "destructive",
      });
    },
  });

  const savePromptOverridesMutation = useMutation({
    mutationFn: async (data: AiPromptOverrides) => {
      const response = await apiRequest("POST", "/api/settings/ai-prompts", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("settings.aiPrompts.saveSuccess"),
        description: t("settings.aiPrompts.saveSuccessDesc"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai-prompts", tenantKey] });
    },
    onError: (error: any) => {
      toast({
        title: t("settings.aiPrompts.saveError"),
        description: error?.message || t("settings.aiPrompts.saveErrorDesc"),
        variant: "destructive",
      });
    },
  });

  const saveB2BStatusMappingMutation = useMutation({
    mutationFn: async (data: OfferStatusMapping) => {
      const response = await apiRequest("POST", "/api/settings/b2b-offer-status-mapping", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/b2b-offer-status-mapping"] });
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/offer-status-mapping"] });
      toast({
        title: t("settings.b2bOfferStatus.saveSuccess"),
        description: t("settings.b2bOfferStatus.saveSuccessDesc"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.b2bOfferStatus.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveOfferConfigPdfTextsMutation = useMutation({
    mutationFn: async (data: OfferConfigPdfTextsForm) => {
      const response = await apiRequest("POST", "/api/settings/offer-config-pdf-texts", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/offer-config-pdf-texts", tenantKey] });
      toast({
        title: t("settings.offerConfigPdf.saveSuccess"),
        description: t("settings.offerConfigPdf.saveSuccessDesc"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.offerConfigPdf.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveSlaSettingsMutation = useMutation({
    mutationFn: async (data: typeof slaSettings) => {
      const response = await apiRequest("POST", "/api/settings/ticket-sla", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ticket-sla"] });
      toast({
        title: t("settings.ticketSla.saveSuccess"),
        description: t("settings.ticketSla.saveSuccessDesc"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.ticketSla.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveInboundSettingsMutation = useMutation({
    mutationFn: async (data: EmailInboundSettings) => {
      const response = await apiRequest("POST", "/api/settings/email-inbound", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/email-inbound"] });
      toast({
        title: t("settings.emailInbound.saveSuccess"),
        description: t("settings.emailInbound.saveSuccessDesc"),
      });
      setEmailInboundSettings((prev) => ({ ...prev, password: "" }));
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.emailInbound.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveOutboundSettingsMutation = useMutation({
    mutationFn: async (data: EmailOutboundSettings) => {
      const response = await apiRequest("POST", "/api/settings/email-outbound", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/email-outbound"] });
      toast({
        title: t("settings.emailOutbound.saveSuccess"),
        description: t("settings.emailOutbound.saveSuccessDesc"),
      });
      setEmailOutboundSettings((prev) => ({ ...prev, password: "" }));
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.emailOutbound.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveRoutingSettingsMutation = useMutation({
    mutationFn: async (data: EmailRoutingSettings) => {
      const response = await apiRequest("POST", "/api/settings/email-routing", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/email-routing"] });
      toast({
        title: t("settings.emailRouting.saveSuccess"),
        description: t("settings.emailRouting.saveSuccessDesc"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.emailRouting.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveM365SettingsMutation = useMutation({
    mutationFn: async (data: M365Settings) => {
      const response = await apiRequest("POST", "/api/settings/m365", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/m365"] });
      toast({
        title: t("settings.m365.saveSuccess"),
        description: t("settings.m365.saveSuccessDesc"),
      });
      setM365Settings((prev) => ({ ...prev, clientSecret: "" }));
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.m365.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const startDeviceCodeFlow = useCallback(async () => {
    setDeviceError("");
    if (!m365Settings.enabled) {
      setDeviceStatus("error");
      setDeviceError(t("settings.m365.deviceCodeDisabled"));
      return;
    }
    if (!m365Settings.clientId) {
      setDeviceStatus("error");
      setDeviceError(t("settings.m365.deviceCodeMissingClientId"));
      return;
    }
    try {
      await saveM365SettingsMutation.mutateAsync(m365Settings);
      const response = await apiRequest("POST", "/api/auth/m365/device/start", {});
      const data = await response.json();
      setDeviceCodeInfo(data);
      setDeviceStatus("pending");
      toast({
        title: t("settings.m365.deviceCodeStarted"),
      });
    } catch (error: any) {
      setDeviceStatus("error");
      setDeviceError(error?.message || t("settings.m365.deviceCodeStartError"));
      toast({
        title: t("settings.m365.deviceCodeStartError"),
        description: error?.message,
        variant: "destructive",
      });
    }
  }, [m365Settings, saveM365SettingsMutation, toast, t]);

  const pollDeviceCode = useCallback(async () => {
    if (!deviceCodeInfo?.state) return;
    try {
      const response = await apiRequest("POST", "/api/auth/m365/device/poll", {
        state: deviceCodeInfo.state,
      });
      const data = await response.json();
      if (data.status === "pending") {
        return;
      }
      if (data.status === "connected") {
        setDeviceStatus("connected");
        setDeviceCodeInfo(null);
        queryClient.invalidateQueries({ queryKey: ["/api/m365/connections"] });
        toast({
          title: t("settings.m365.deviceCodeConnected"),
          description: data.email,
        });
        return;
      }
      if (data.status === "expired") {
        setDeviceStatus("expired");
        setDeviceError(t("settings.m365.deviceCodeExpired"));
        return;
      }
      if (data.status === "denied") {
        setDeviceStatus("denied");
        setDeviceError(t("settings.m365.deviceCodeDenied"));
        return;
      }
      setDeviceStatus("error");
      setDeviceError(data.error || t("settings.m365.deviceCodePollError"));
    } catch (error: any) {
      setDeviceStatus("error");
      setDeviceError(error?.message || t("settings.m365.deviceCodePollError"));
    }
  }, [deviceCodeInfo, toast, t]);

  useEffect(() => {
    if (!deviceCodeInfo || deviceStatus !== "pending") return;
    const intervalMs = (deviceCodeInfo.interval || 5) * 1000;
    const timer = window.setInterval(() => {
      pollDeviceCode();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [deviceCodeInfo, deviceStatus, pollDeviceCode]);

  const disconnectM365Mutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/m365/connections/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/m365/connections"] });
      toast({
        title: t("settings.m365.disconnectSuccess"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.m365.disconnectError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveGaSettingsMutation = useMutation({
    mutationFn: async (data: GoogleAnalyticsSettings & { propertyIdsInput: string }) => {
      const response = await apiRequest("POST", "/api/settings/google-analytics", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/google-analytics"] });
      toast({
        title: t("settings.googleAnalytics.saveSuccess"),
        description: t("settings.googleAnalytics.saveSuccessDesc"),
      });
      setGaSettings((prev) => ({ ...prev, serviceAccountJson: "" }));
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.googleAnalytics.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveAdsSettingsMutation = useMutation({
    mutationFn: async (data: GoogleAdsSettings & { customerIdsInput: string }) => {
      const response = await apiRequest("POST", "/api/settings/google-ads", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/google-ads"] });
      toast({
        title: t("settings.googleAds.saveSuccess"),
        description: t("settings.googleAds.saveSuccessDesc"),
      });
      setAdsSettings((prev) => ({
        ...prev,
        developerToken: "",
        clientId: "",
        clientSecret: "",
        refreshToken: "",
      }));
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.googleAds.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveTenantSelectionMutation = useMutation({
    mutationFn: async (tenantId: string | null) => {
      const response = await apiRequest("POST", "/api/tenants/select", { tenantId });
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/tenants"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }),
      ]);
      toast({
        title: t("settings.tenants.saveSuccess"),
        description: t("settings.tenants.saveSuccessDesc"),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("settings.tenants.saveError"),
        description: error?.message || t("settings.tenants.saveErrorDesc"),
        variant: "destructive",
      });
    },
  });

  const saveProformaNumberRangeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/settings/proforma-number-range", proformaNumberRange);
      return response.json();
    },
    onSuccess: (data: ProformaNumberRangeSettings) => {
      setProformaNumberRange(data);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/proforma-number-range", tenantKey] });
      toast({
        title: t("settings.tenants.proformaSaveSuccess"),
        description: t("settings.tenants.proformaSaveSuccessDesc"),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("settings.tenants.proformaSaveError"),
        description: error?.message || t("settings.tenants.proformaSaveErrorDesc"),
        variant: "destructive",
      });
    },
  });

  const saveDunningSettingsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/settings/dunning", dunningSettings);
      return response.json();
    },
    onSuccess: (data: DunningSettings) => {
      setDunningSettings(data);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/dunning", tenantKey] });
      toast({
        title: t("settings.tenants.dunningSaveSuccess"),
        description: t("settings.tenants.dunningSaveSuccessDesc"),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("settings.tenants.dunningSaveError"),
        description: error?.message || t("settings.tenants.dunningSaveErrorDesc"),
        variant: "destructive",
      });
    },
  });

  const getOfferStatusOptionLabel = (status: OfferStatusRecord) => {
    const flags = [];
    if (status.draft) flags.push(t("settings.b2bOfferStatus.flags.draft"));
    if (status.open) flags.push(t("settings.b2bOfferStatus.flags.open"));
    if (status.confirmed) flags.push(t("settings.b2bOfferStatus.flags.confirmed"));
    if (status.declined) flags.push(t("settings.b2bOfferStatus.flags.declined"));
    const label = status.label || t("common.unknown");
    return flags.length > 0 ? `${label} (${flags.join(", ")})` : label;
  };

  const updateOfferStatusMapping = (key: keyof OfferStatusMapping, selectedId: string) => {
    const statuses = offerStatusesData?.statuses || [];
    const normalizedId = selectedId === "__unmapped__" ? "" : selectedId;
    const selected = statuses.find((status) => status.id === normalizedId);
    setOfferStatusMapping((prev) => ({
      ...(prev || (b2bStatusMappingData?.mapping as OfferStatusMapping)),
      [key]: {
        id: normalizedId || null,
        label: selected?.label || "",
      },
    }));
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const trimmedSecret = apiSecret.trim();
      await apiRequest('POST', '/api/settings/shopware/test', {
        shopwareUrl,
        apiKey,
        ...(trimmedSecret ? { apiSecret: trimmedSecret } : {}),
      });

      toast({
        title: "Connection successful",
        description: "Successfully connected to Shopware API.",
      });
    } catch (error: any) {
      console.error("Connection test failed:", error);
      toast({
        title: "Connection failed",
        description: error.message || "Could not connect to Shopware API. Please check your credentials.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const trimmedSecret = apiSecret.trim();
      await apiRequest('POST', '/api/settings/shopware', {
        shopwareUrl,
        apiKey,
        ...(trimmedSecret ? { apiSecret: trimmedSecret } : {}),
      });

      toast({
        title: "Settings saved",
        description: "Your Shopware connection settings have been updated successfully.",
      });
      setApiSecret("");
      setHasShopwareSecret(true);
    } catch (error: any) {
      console.error("Save settings failed:", error);
      toast({
        title: "Save failed",
        description: error.message || "Could not save settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const categoryOptions: TicketCategory[] = [
    "general",
    "order_issue",
    "product_inquiry",
    "technical_support",
    "complaint",
    "feature_request",
    "other",
  ];

  const priorityOptions: TicketPriority[] = ["low", "normal", "high", "urgent"];

  const addRoutingRule = () => {
    setEmailRoutingSettings((prev) => ({
      ...prev,
      fallbackRules: [
        ...(prev.fallbackRules || []),
        { pattern: "", target: "all" } as EmailRoutingRule,
      ],
    }));
  };

  const updateRoutingRule = (index: number, patch: Partial<EmailRoutingRule>) => {
    setEmailRoutingSettings((prev) => ({
      ...prev,
      fallbackRules: (prev.fallbackRules || []).map((rule, idx) =>
        idx === index ? { ...rule, ...patch } : rule
      ),
    }));
  };

  const removeRoutingRule = (index: number) => {
    setEmailRoutingSettings((prev) => ({
      ...prev,
      fallbackRules: (prev.fallbackRules || []).filter((_, idx) => idx !== index),
    }));
  };

  const tenants = tenantData?.tenants || [];
  const activeTenantId = tenantData?.activeTenantId || "";
  const hasTenants = tenants.length > 0;
  const hasTenantChange = (selectedTenantId || "") !== activeTenantId;



function GeneralTab() {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.tenants.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.tenants.description")}
        </p>
        {tenantLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !hasTenants ? (
          <p className="text-sm text-muted-foreground">{t("settings.tenants.noTenants")}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label className="text-sm font-medium">{t("settings.tenants.selectLabel")}</Label>
              <Select value={selectedTenantId || ""} onValueChange={setSelectedTenantId}>
                <SelectTrigger data-testid="select-active-tenant">
                  <SelectValue placeholder={t("settings.tenants.selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                onClick={() => saveTenantSelectionMutation.mutate(selectedTenantId || null)}
                disabled={!selectedTenantId || !hasTenantChange || saveTenantSelectionMutation.isPending}
                data-testid="button-save-tenant"
              >
                {saveTenantSelectionMutation.isPending
                  ? t("settings.tenants.saving")
                  : t("settings.tenants.save")}
              </Button>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-2">
                {t("settings.tenants.proformaTitle")}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                {t("settings.tenants.proformaDescription")}
              </p>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">{t("settings.tenants.proformaPrefix")}</Label>
                  <Input
                    value={proformaNumberRange.prefix}
                    onChange={(e) =>
                      setProformaNumberRange((prev) => ({ ...prev, prefix: e.target.value }))
                    }
                    data-testid="input-proforma-prefix"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">{t("settings.tenants.proformaNextNumber")}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={proformaNumberRange.nextNumber}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setProformaNumberRange((prev) => ({
                        ...prev,
                        nextNumber: Number.isFinite(value) ? value : prev.nextNumber,
                      }));
                    }}
                    data-testid="input-proforma-next-number"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">{t("settings.tenants.proformaPadding")}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={12}
                    value={proformaNumberRange.padding}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setProformaNumberRange((prev) => ({
                        ...prev,
                        padding: Number.isFinite(value) ? value : prev.padding,
                      }));
                    }}
                    data-testid="input-proforma-padding"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    onClick={() => saveProformaNumberRangeMutation.mutate()}
                    disabled={!selectedTenantId || saveProformaNumberRangeMutation.isPending}
                    data-testid="button-save-proforma-number-range"
                  >
                    {saveProformaNumberRangeMutation.isPending
                      ? t("settings.tenants.proformaSaving")
                      : t("settings.tenants.proformaSave")}
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-2">
                {t("settings.tenants.dunningTitle")}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                {t("settings.tenants.dunningDescription")}
              </p>
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-4">
                  <Label className="text-sm font-medium">{t("settings.tenants.dunningEnabled")}</Label>
                  <Switch
                    checked={dunningSettings.enabled}
                    onCheckedChange={(value) =>
                      setDunningSettings((prev) => ({ ...prev, enabled: value }))
                    }
                    data-testid="switch-dunning-enabled"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Label className="text-sm font-medium">{t("settings.tenants.dunningManualOnly")}</Label>
                  <Switch
                    checked={dunningSettings.manualOnly}
                    onCheckedChange={(value) =>
                      setDunningSettings((prev) => ({ ...prev, manualOnly: value }))
                    }
                    data-testid="switch-dunning-manual-only"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="text-sm font-medium">{t("settings.tenants.dunningGeneratePdfInApp")}</Label>
                    <p className="text-xs text-muted-foreground">{t("settings.tenants.dunningGeneratePdfInAppHelp")}</p>
                  </div>
                  <Switch
                    checked={dunningSettings.generatePdfInApp !== false}
                    onCheckedChange={(value) =>
                      setDunningSettings((prev) => ({ ...prev, generatePdfInApp: value }))
                    }
                    data-testid="switch-dunning-generate-pdf-in-app"
                  />
                </div>
                {dunningSettings.generatePdfInApp !== false && (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label className="text-sm font-medium">{t("settings.tenants.dunningSavePdfToShop")}</Label>
                      <p className="text-xs text-muted-foreground">{t("settings.tenants.dunningSavePdfToShopHelp")}</p>
                    </div>
                    <Switch
                      checked={dunningSettings.savePdfToShop === true}
                      onCheckedChange={(value) =>
                        setDunningSettings((prev) => ({ ...prev, savePdfToShop: value }))
                      }
                      data-testid="switch-dunning-save-pdf-to-shop"
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">{t("settings.tenants.dunningDueDateField")}</Label>
                  <Input
                    value={dunningSettings.dueDateFieldKey}
                    onChange={(e) =>
                      setDunningSettings((prev) => ({ ...prev, dueDateFieldKey: e.target.value }))
                    }
                    data-testid="input-dunning-due-date-field"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">{t("settings.tenants.dunningDocumentType")}</Label>
                  <Input
                    value={dunningSettings.documentTypeTechnicalName}
                    onChange={(e) =>
                      setDunningSettings((prev) => ({ ...prev, documentTypeTechnicalName: e.target.value }))
                    }
                    data-testid="input-dunning-document-type"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("settings.tenants.dunningDocumentTypeHelp")}{" "}
                    <a
                      href="https://developer.shopware.com/docs/guides/plugins/plugins/checkout/document/add-custom-document-type.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline hover:no-underline"
                    >
                      {t("settings.tenants.dunningDocumentTypeHelpLink")}
                    </a>
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">{t("settings.tenants.dunningStageDays")}</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {dunningSettings.stageDays.map((value, index) => (
                      <Input
                        key={`dunning-stage-${index}`}
                        type="number"
                        min={1}
                        value={value}
                        onChange={(e) => {
                          const nextValue = Number(e.target.value);
                          setDunningSettings((prev) => ({
                            ...prev,
                            stageDays: prev.stageDays.map((day, dayIndex) =>
                              dayIndex === index && Number.isFinite(nextValue) ? nextValue : day
                            ) as [number, number, number],
                          }));
                        }}
                        data-testid={`input-dunning-stage-${index + 1}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">{t("settings.tenants.dunningEmailSubject")}</Label>
                  <Input
                    value={dunningSettings.emailSubjectTemplate}
                    onChange={(e) =>
                      setDunningSettings((prev) => ({ ...prev, emailSubjectTemplate: e.target.value }))
                    }
                    data-testid="input-dunning-email-subject"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">{t("settings.tenants.dunningEmailBody")}</Label>
                  <Textarea
                    value={dunningSettings.emailBodyTemplate}
                    onChange={(e) =>
                      setDunningSettings((prev) => ({ ...prev, emailBodyTemplate: e.target.value }))
                    }
                    rows={5}
                    data-testid="input-dunning-email-body"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    onClick={() => saveDunningSettingsMutation.mutate()}
                    disabled={!selectedTenantId || saveDunningSettingsMutation.isPending}
                    data-testid="button-save-dunning"
                  >
                    {saveDunningSettingsMutation.isPending
                      ? t("settings.tenants.dunningSaving")
                      : t("settings.tenants.dunningSave")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          User Preferences
        </h2>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2">Default Items Per Page</Label>
            <Input
              type="number"
              defaultValue="25"
              min="10"
              max="200"
              data-testid="input-default-items-per-page"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Number of orders to display per page by default
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ShopwareTab() {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          Shopware Admin API Configuration
        </h2>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2">Shopware URL</Label>
            <Input
              placeholder="https://your-shopware-store.com"
              value={shopwareUrl}
              onChange={(e) => setShopwareUrl(e.target.value)}
              data-testid="input-shopware-url"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The base URL of your Shopware 6 instance
            </p>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2">API Access Key</Label>
            <Input
              placeholder="Enter your API access key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono"
              data-testid="input-api-key"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Your Shopware Admin API access key
            </p>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2">API Secret Key</Label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
              placeholder={hasShopwareSecret ? "••••••••••••••••••••" : "Enter your API secret key"}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="font-mono pr-10"
                data-testid="input-api-secret"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setShowSecret(!showSecret)}
                data-testid="button-toggle-secret-visibility"
              >
                {showSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Your Shopware Admin API secret key (will be stored securely)
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button 
              variant="outline" 
              onClick={handleTestConnection}
              disabled={isTesting || isSaving || !shopwareUrl || !apiKey || (!apiSecret && !hasShopwareSecret)}
              data-testid="button-test-connection"
            >
              {isTesting ? "Testing..." : "Test Connection"}
            </Button>
            <Button 
              onClick={handleSave}
              disabled={isSaving || isTesting || !shopwareUrl || !apiKey || (!apiSecret && !hasShopwareSecret)}
              data-testid="button-save-settings"
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.b2bOfferStatus.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.b2bOfferStatus.description")}
        </p>

        {b2bStatusMappingLoading || offerStatusesLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3">
              {([
                "draft",
                "submitted",
                "sent",
                "approved",
                "rejected",
              ] as Array<keyof OfferStatusMapping>).map((key) => (
                <div key={key} className="grid gap-2">
                  <Label className="text-sm font-medium">
                    {t(`offers.status.${key}`)}
                  </Label>
                  <Select
                    value={offerStatusMapping?.[key]?.id || "__unmapped__"}
                    onValueChange={(value) => updateOfferStatusMapping(key, value)}
                  >
                    <SelectTrigger data-testid={`select-b2b-status-${key}`}>
                      <SelectValue placeholder={t("settings.b2bOfferStatus.unmapped")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unmapped__">{t("settings.b2bOfferStatus.unmapped")}</SelectItem>
                      {(offerStatusesData?.statuses || []).map((status) => (
                        <SelectItem key={status.id} value={status.id}>
                          {getOfferStatusOptionLabel(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setOfferStatusMapping(b2bStatusMappingData?.defaults || null)}
                disabled={!b2bStatusMappingData?.defaults || saveB2BStatusMappingMutation.isPending}
                data-testid="button-reset-b2b-status-mapping"
              >
                {t("settings.b2bOfferStatus.reset")}
              </Button>
              <Button
                onClick={() => offerStatusMapping && saveB2BStatusMappingMutation.mutate(offerStatusMapping)}
                disabled={!offerStatusMapping || saveB2BStatusMappingMutation.isPending}
                data-testid="button-save-b2b-status-mapping"
              >
                {saveB2BStatusMappingMutation.isPending
                  ? t("settings.b2bOfferStatus.saving")
                  : t("settings.b2bOfferStatus.save")}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <WebhooksSettingsSection />
    </div>
  );
}

function OffersTab() {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.offerConfigPdf.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-2">
          {t("settings.offerConfigPdf.description")}
        </p>
        <p className="text-xs text-muted-foreground mb-4 font-mono break-all">
          {t("settings.offerConfigPdf.placeholdersHint")}
        </p>

        {offerConfigPdfTextsLoading || !offerConfigPdfForm ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("settings.offerConfigPdf.introLabel")}</Label>
              <Textarea
                value={offerConfigPdfForm.introTemplate}
                onChange={(e) =>
                  setOfferConfigPdfForm((prev) =>
                    prev ? { ...prev, introTemplate: e.target.value } : prev,
                  )
                }
                rows={8}
                className="font-sans text-sm min-h-[160px]"
                data-testid="textarea-offer-pdf-intro"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("settings.offerConfigPdf.systemInfoTitleLabel")}</Label>
              <Input
                value={offerConfigPdfForm.systemInfoTitle}
                onChange={(e) =>
                  setOfferConfigPdfForm((prev) =>
                    prev ? { ...prev, systemInfoTitle: e.target.value } : prev,
                  )
                }
                className="text-sm"
                data-testid="input-offer-pdf-system-title"
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">{t("settings.offerConfigPdf.systemSection")}</p>
              {OFFER_PDF_SYSTEM_KEYS.map((key) => (
                <div key={key} className="space-y-2">
                  <Label className="text-sm text-muted-foreground">
                    {t(`settings.offerConfigPdf.systemKeys.${key}`)}
                  </Label>
                  <Textarea
                    value={offerConfigPdfForm.systemInfoByKey[key] ?? ""}
                    onChange={(e) =>
                      setOfferConfigPdfForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              systemInfoByKey: {
                                ...prev.systemInfoByKey,
                                [key]: e.target.value,
                              },
                            }
                          : prev,
                      )
                    }
                    rows={5}
                    className="font-sans text-sm min-h-[100px]"
                    data-testid={`textarea-offer-pdf-system-${key}`}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("settings.offerConfigPdf.standardTitleLabel")}</Label>
              <Input
                value={offerConfigPdfForm.standardClosingTitle}
                onChange={(e) =>
                  setOfferConfigPdfForm((prev) =>
                    prev ? { ...prev, standardClosingTitle: e.target.value } : prev,
                  )
                }
                className="text-sm"
                data-testid="input-offer-pdf-standard-title"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("settings.offerConfigPdf.standardBodyLabel")}</Label>
              <Textarea
                value={offerConfigPdfForm.standardClosing}
                onChange={(e) =>
                  setOfferConfigPdfForm((prev) =>
                    prev ? { ...prev, standardClosing: e.target.value } : prev,
                  )
                }
                rows={6}
                className="font-sans text-sm min-h-[120px]"
                data-testid="textarea-offer-pdf-standard"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const d = offerConfigPdfTextsData?.defaults;
                  if (d) {
                    setOfferConfigPdfForm({
                      introTemplate: d.introTemplate,
                      systemInfoTitle: d.systemInfoTitle,
                      systemInfoByKey: { ...d.systemInfoByKey },
                      standardClosingTitle: d.standardClosingTitle,
                      standardClosing: d.standardClosing,
                    });
                  }
                }}
                disabled={!offerConfigPdfTextsData?.defaults || saveOfferConfigPdfTextsMutation.isPending}
                data-testid="button-reset-offer-pdf-texts"
              >
                {t("settings.offerConfigPdf.reset")}
              </Button>
              <Button
                type="button"
                onClick={() => offerConfigPdfForm && saveOfferConfigPdfTextsMutation.mutate(offerConfigPdfForm)}
                disabled={saveOfferConfigPdfTextsMutation.isPending}
                data-testid="button-save-offer-pdf-texts"
              >
                {saveOfferConfigPdfTextsMutation.isPending
                  ? t("settings.offerConfigPdf.saving")
                  : t("settings.offerConfigPdf.save")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function TicketsTab() {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.ticketSla.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.ticketSla.description")}
        </p>

        {slaSettingsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("tickets.priorityLow")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={slaSettings.lowDays}
                  onChange={(e) => setSlaSettings({ ...slaSettings, lowDays: Number(e.target.value) })}
                  data-testid="input-sla-low"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("tickets.priorityNormal")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={slaSettings.normalDays}
                  onChange={(e) => setSlaSettings({ ...slaSettings, normalDays: Number(e.target.value) })}
                  data-testid="input-sla-normal"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("tickets.priorityHigh")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={slaSettings.highDays}
                  onChange={(e) => setSlaSettings({ ...slaSettings, highDays: Number(e.target.value) })}
                  data-testid="input-sla-high"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("tickets.priorityUrgent")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={slaSettings.urgentDays}
                  onChange={(e) => setSlaSettings({ ...slaSettings, urgentDays: Number(e.target.value) })}
                  data-testid="input-sla-urgent"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => saveSlaSettingsMutation.mutate(slaSettings)}
                disabled={saveSlaSettingsMutation.isPending}
                data-testid="button-save-sla-settings"
              >
                {saveSlaSettingsMutation.isPending
                  ? t("settings.ticketSla.saving")
                  : t("settings.ticketSla.save")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function EmailTab() {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.m365.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.m365.description")}
        </p>

        {m365SettingsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{t("settings.m365.enabled")}</Label>
                <p className="text-xs text-muted-foreground">{t("settings.m365.enabledDesc")}</p>
              </div>
              <Switch
                checked={m365Settings.enabled}
                onCheckedChange={(value) => setM365Settings({ ...m365Settings, enabled: value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.m365.clientId")}</Label>
                <Input
                  value={m365Settings.clientId}
                  onChange={(e) => setM365Settings({ ...m365Settings, clientId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.m365.authFlow")}</Label>
                <Select
                  value={m365Settings.authFlow || "auth_code"}
                  onValueChange={(value) => setM365Settings({ ...m365Settings, authFlow: value as M365Settings["authFlow"] })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("settings.m365.authFlowPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="device_code">{t("settings.m365.authFlowDevice")}</SelectItem>
                    <SelectItem value="auth_code">{t("settings.m365.authFlowAuthCode")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {m365Settings.authFlow !== "device_code" && (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t("settings.m365.clientSecret")}</Label>
                    <Input
                      type="password"
                      placeholder={hasM365Secret ? "••••••••••" : ""}
                      value={m365Settings.clientSecret || ""}
                      onChange={(e) => setM365Settings({ ...m365Settings, clientSecret: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="text-sm font-medium">{t("settings.m365.redirectUri")}</Label>
                    <Input
                      value={m365Settings.redirectUri}
                      onChange={(e) => setM365Settings({ ...m365Settings, redirectUri: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={m365Settings.enableGraph}
                  onCheckedChange={(value) => setM365Settings({ ...m365Settings, enableGraph: value })}
                />
                <Label className="text-sm">{t("settings.m365.enableGraph")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={m365Settings.enableImapSmtp}
                  onCheckedChange={(value) => setM365Settings({ ...m365Settings, enableImapSmtp: value })}
                />
                <Label className="text-sm">{t("settings.m365.enableImapSmtp")}</Label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                onClick={() => saveM365SettingsMutation.mutate(m365Settings)}
                disabled={saveM365SettingsMutation.isPending}
              >
                {saveM365SettingsMutation.isPending
                  ? t("settings.m365.saving")
                  : t("settings.m365.save")}
              </Button>
              <Button
                variant="outline"
                disabled={!m365Settings.enabled || saveM365SettingsMutation.isPending}
                onClick={async () => {
                  if ((m365Settings.authFlow || "auth_code") === "device_code") {
                    await startDeviceCodeFlow();
                    return;
                  }
                  try {
                    await saveM365SettingsMutation.mutateAsync(m365Settings);
                    window.location.assign("/api/auth/m365/start");
                  } catch {
                    // Error toast handled in mutation
                  }
                }}
              >
                {(m365Settings.authFlow || "auth_code") === "device_code"
                  ? t("settings.m365.deviceCodeStart")
                  : t("settings.m365.connect")}
              </Button>
            </div>

            {(m365Settings.authFlow || "auth_code") === "device_code" && (
              <div className="border rounded-md p-3 space-y-2">
                <div className="text-sm font-medium">{t("settings.m365.deviceCodeTitle")}</div>
                <p className="text-xs text-muted-foreground">{t("settings.m365.deviceCodeHint")}</p>
                {deviceCodeInfo && (
                  <div className="space-y-2">
                    <div className="text-sm">
                      {t("settings.m365.deviceCodeUserCode")}: <span className="font-mono">{deviceCodeInfo.userCode}</span>
                    </div>
                    <div className="text-xs">
                      <a
                        href={deviceCodeInfo.verificationUriComplete || deviceCodeInfo.verificationUri}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {deviceCodeInfo.verificationUri}
                      </a>
                    </div>
                    {deviceCodeInfo.message && (
                      <div className="text-xs text-muted-foreground">{deviceCodeInfo.message}</div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {t("settings.m365.deviceCodeExpires")}: {new Date(deviceCodeInfo.expiresAt).toLocaleString()}
                    </div>
                  </div>
                )}
                {deviceStatus === "error" && (
                  <div className="text-xs text-destructive">{deviceError}</div>
                )}
                {deviceStatus === "expired" && (
                  <div className="text-xs text-destructive">{t("settings.m365.deviceCodeExpired")}</div>
                )}
                {deviceStatus === "denied" && (
                  <div className="text-xs text-destructive">{t("settings.m365.deviceCodeDenied")}</div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startDeviceCodeFlow}
                    disabled={!m365Settings.enabled}
                  >
                    {t("settings.m365.deviceCodeStart")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={pollDeviceCode}
                    disabled={!deviceCodeInfo || deviceStatus === "connected"}
                  >
                    {t("settings.m365.deviceCodeCheck")}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("settings.m365.connectedAccounts")}</Label>
              {m365Connections.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("settings.m365.noConnections")}</p>
              ) : (
                <div className="space-y-2">
                  {m365Connections.map((connection) => (
                    <div key={connection.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">{connection.email}</div>
                        <div className="text-xs text-muted-foreground">{connection.tenantId}</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => disconnectM365Mutation.mutate(connection.id)}
                      >
                        {t("settings.m365.disconnect")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.emailInbound.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.emailInbound.description")}
        </p>

        {inboundSettingsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{t("settings.emailInbound.enabled")}</Label>
                <p className="text-xs text-muted-foreground">{t("settings.emailInbound.enabledDesc")}</p>
              </div>
              <Switch
                checked={emailInboundSettings.enabled}
                onCheckedChange={(value) => setEmailInboundSettings({ ...emailInboundSettings, enabled: value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailInbound.host")}</Label>
                <Input
                  value={emailInboundSettings.host}
                  onChange={(e) => setEmailInboundSettings({ ...emailInboundSettings, host: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailInbound.port")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={emailInboundSettings.port}
                  onChange={(e) => setEmailInboundSettings({ ...emailInboundSettings, port: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailInbound.user")}</Label>
                <Input
                  value={emailInboundSettings.user}
                  onChange={(e) => setEmailInboundSettings({ ...emailInboundSettings, user: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailInbound.password")}</Label>
                <Input
                  type="password"
                  placeholder={hasInboundPassword ? "••••••••••" : ""}
                  value={emailInboundSettings.password || ""}
                  onChange={(e) => setEmailInboundSettings({ ...emailInboundSettings, password: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailInbound.mailbox")}</Label>
                <Input
                  value={emailInboundSettings.mailbox}
                  onChange={(e) => setEmailInboundSettings({ ...emailInboundSettings, mailbox: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailInbound.pollInterval")}</Label>
                <Input
                  type="number"
                  min={10}
                  max={3600}
                  value={emailInboundSettings.pollIntervalSeconds}
                  onChange={(e) =>
                    setEmailInboundSettings({
                      ...emailInboundSettings,
                      pollIntervalSeconds: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailInbound.maxMessages")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={emailInboundSettings.maxMessages}
                  onChange={(e) =>
                    setEmailInboundSettings({
                      ...emailInboundSettings,
                      maxMessages: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={emailInboundSettings.secure}
                  onCheckedChange={(value) => setEmailInboundSettings({ ...emailInboundSettings, secure: value })}
                />
                <Label className="text-sm">{t("settings.emailInbound.secure")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={emailInboundSettings.markAsSeen}
                  onCheckedChange={(value) => setEmailInboundSettings({ ...emailInboundSettings, markAsSeen: value })}
                />
                <Label className="text-sm">{t("settings.emailInbound.markAsSeen")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={emailInboundSettings.allowAttachments}
                  onCheckedChange={(value) => setEmailInboundSettings({ ...emailInboundSettings, allowAttachments: value })}
                />
                <Label className="text-sm">{t("settings.emailInbound.allowAttachments")}</Label>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => saveInboundSettingsMutation.mutate(emailInboundSettings)}
                disabled={saveInboundSettingsMutation.isPending}
              >
                {saveInboundSettingsMutation.isPending
                  ? t("settings.emailInbound.saving")
                  : t("settings.emailInbound.save")}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.emailOutbound.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.emailOutbound.description")}
        </p>

        {outboundSettingsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{t("settings.emailOutbound.enabled")}</Label>
                <p className="text-xs text-muted-foreground">{t("settings.emailOutbound.enabledDesc")}</p>
              </div>
              <Switch
                checked={emailOutboundSettings.enabled}
                onCheckedChange={(value) => setEmailOutboundSettings({ ...emailOutboundSettings, enabled: value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailOutbound.m365Connection")}</Label>
                <Select
                  value={emailOutboundSettings.m365ConnectionId || "__none__"}
                  onValueChange={(value) =>
                    setEmailOutboundSettings({
                      ...emailOutboundSettings,
                      m365ConnectionId: value === "__none__" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("settings.emailOutbound.m365ConnectionPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("settings.emailOutbound.m365ConnectionNone")}</SelectItem>
                    {m365Connections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailOutbound.host")}</Label>
                <Input
                  value={emailOutboundSettings.host}
                  onChange={(e) => setEmailOutboundSettings({ ...emailOutboundSettings, host: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailOutbound.port")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={emailOutboundSettings.port}
                  onChange={(e) => setEmailOutboundSettings({ ...emailOutboundSettings, port: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailOutbound.user")}</Label>
                <Input
                  value={emailOutboundSettings.user}
                  onChange={(e) => setEmailOutboundSettings({ ...emailOutboundSettings, user: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailOutbound.password")}</Label>
                <Input
                  type="password"
                  placeholder={hasOutboundPassword ? "••••••••••" : ""}
                  value={emailOutboundSettings.password || ""}
                  onChange={(e) => setEmailOutboundSettings({ ...emailOutboundSettings, password: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailOutbound.fromAddress")}</Label>
                <Input
                  value={emailOutboundSettings.fromAddress}
                  onChange={(e) => setEmailOutboundSettings({ ...emailOutboundSettings, fromAddress: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailOutbound.fromName")}</Label>
                <Input
                  value={emailOutboundSettings.fromName || ""}
                  onChange={(e) => setEmailOutboundSettings({ ...emailOutboundSettings, fromName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailOutbound.replyTo")}</Label>
                <Input
                  value={emailOutboundSettings.replyTo || ""}
                  onChange={(e) => setEmailOutboundSettings({ ...emailOutboundSettings, replyTo: e.target.value })}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={emailOutboundSettings.secure}
                  onCheckedChange={(value) => setEmailOutboundSettings({ ...emailOutboundSettings, secure: value })}
                />
                <Label className="text-sm">{t("settings.emailOutbound.secure")}</Label>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => saveOutboundSettingsMutation.mutate(emailOutboundSettings)}
                disabled={saveOutboundSettingsMutation.isPending}
              >
                {saveOutboundSettingsMutation.isPending
                  ? t("settings.emailOutbound.saving")
                  : t("settings.emailOutbound.save")}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.emailRouting.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.emailRouting.description")}
        </p>

        {routingSettingsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{t("settings.emailRouting.enabled")}</Label>
                <p className="text-xs text-muted-foreground">{t("settings.emailRouting.enabledDesc")}</p>
              </div>
              <Switch
                checked={emailRoutingSettings.enabled}
                onCheckedChange={(value) => setEmailRoutingSettings({ ...emailRoutingSettings, enabled: value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailRouting.threshold")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={emailRoutingSettings.confidenceThreshold}
                  onChange={(e) =>
                    setEmailRoutingSettings({
                      ...emailRoutingSettings,
                      confidenceThreshold: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailRouting.defaultSkill")}</Label>
                <Input
                  value={emailRoutingSettings.defaultSkill || ""}
                  onChange={(e) =>
                    setEmailRoutingSettings({ ...emailRoutingSettings, defaultSkill: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailRouting.defaultCategory")}</Label>
                <Select
                  value={emailRoutingSettings.defaultCategory}
                  onValueChange={(value) =>
                    setEmailRoutingSettings({ ...emailRoutingSettings, defaultCategory: value as TicketCategory })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((category) => (
                      <SelectItem key={category} value={category}>
                        {t(`tickets.category${category.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.emailRouting.defaultPriority")}</Label>
                <Select
                  value={emailRoutingSettings.defaultPriority}
                  onValueChange={(value) =>
                    setEmailRoutingSettings({ ...emailRoutingSettings, defaultPriority: value as TicketPriority })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {t(`tickets.priority${priority.charAt(0).toUpperCase() + priority.slice(1)}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t("settings.emailRouting.fallbackRules")}</Label>
                <Button variant="outline" size="sm" onClick={addRoutingRule}>
                  {t("settings.emailRouting.addRule")}
                </Button>
              </div>
              <div className="space-y-3">
                {emailRoutingSettings.fallbackRules?.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t("settings.emailRouting.noRules")}</p>
                )}
                {emailRoutingSettings.fallbackRules?.map((rule, index) => (
                  <div key={`${rule.pattern}-${index}`} className="grid gap-2 border rounded-md p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{t("settings.emailRouting.pattern")}</Label>
                        <Input
                          value={rule.pattern}
                          onChange={(e) => updateRoutingRule(index, { pattern: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("settings.emailRouting.target")}</Label>
                        <Select
                          value={rule.target}
                          onValueChange={(value) => updateRoutingRule(index, { target: value as EmailRoutingRule["target"] })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["subject", "body", "from", "all"].map((target) => (
                              <SelectItem key={target} value={target}>
                                {t(`settings.emailRouting.target${target.charAt(0).toUpperCase() + target.slice(1)}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("settings.emailRouting.ruleCategory")}</Label>
                        <Select
                          value={rule.category || ""}
                          onValueChange={(value) => updateRoutingRule(index, { category: value as TicketCategory })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("settings.emailRouting.optional")} />
                          </SelectTrigger>
                          <SelectContent>
                            {categoryOptions.map((category) => (
                              <SelectItem key={category} value={category}>
                                {t(`tickets.category${category.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("settings.emailRouting.rulePriority")}</Label>
                        <Select
                          value={rule.priority || ""}
                          onValueChange={(value) => updateRoutingRule(index, { priority: value as TicketPriority })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("settings.emailRouting.optional")} />
                          </SelectTrigger>
                          <SelectContent>
                            {priorityOptions.map((priority) => (
                              <SelectItem key={priority} value={priority}>
                                {t(`tickets.priority${priority.charAt(0).toUpperCase() + priority.slice(1)}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("settings.emailRouting.ruleSkill")}</Label>
                        <Input
                          value={rule.skill || ""}
                          onChange={(e) => updateRoutingRule(index, { skill: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" onClick={() => removeRoutingRule(index)}>
                        {t("settings.emailRouting.removeRule")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => saveRoutingSettingsMutation.mutate(emailRoutingSettings)}
                disabled={saveRoutingSettingsMutation.isPending}
              >
                {saveRoutingSettingsMutation.isPending
                  ? t("settings.emailRouting.saving")
                  : t("settings.emailRouting.save")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function MarketingTab() {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.googleAnalytics.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.googleAnalytics.description")}
        </p>

        {gaSettingsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{t("settings.googleAnalytics.enabled")}</Label>
                <p className="text-xs text-muted-foreground">{t("settings.googleAnalytics.enabledDesc")}</p>
              </div>
              <Switch
                checked={gaSettings.enabled}
                onCheckedChange={(value) => setGaSettings({ ...gaSettings, enabled: value })}
              />
            </div>

            <div className="grid gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.googleAnalytics.propertyIds")}</Label>
                <Input
                  value={gaPropertyIdsInput}
                  onChange={(e) => setGaPropertyIdsInput(e.target.value)}
                  placeholder="123456789, 987654321"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.googleAnalytics.serviceAccountJson")}</Label>
                <Textarea
                  rows={6}
                  placeholder={hasGaServiceAccount ? "••••••••••" : ""}
                  value={gaSettings.serviceAccountJson || ""}
                  onChange={(e) => setGaSettings({ ...gaSettings, serviceAccountJson: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() =>
                  saveGaSettingsMutation.mutate({
                    ...gaSettings,
                    propertyIdsInput: gaPropertyIdsInput,
                  })
                }
                disabled={saveGaSettingsMutation.isPending}
              >
                {saveGaSettingsMutation.isPending
                  ? t("settings.googleAnalytics.saving")
                  : t("settings.googleAnalytics.save")}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.googleAds.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.googleAds.description")}
        </p>

        {adsSettingsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{t("settings.googleAds.enabled")}</Label>
                <p className="text-xs text-muted-foreground">{t("settings.googleAds.enabledDesc")}</p>
              </div>
              <Switch
                checked={adsSettings.enabled}
                onCheckedChange={(value) => setAdsSettings({ ...adsSettings, enabled: value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-sm font-medium">{t("settings.googleAds.customerIds")}</Label>
                <Input
                  value={adsCustomerIdsInput}
                  onChange={(e) => setAdsCustomerIdsInput(e.target.value)}
                  placeholder="1234567890, 0987654321"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.googleAds.developerToken")}</Label>
                <Input
                  placeholder={hasAdsDeveloperToken ? "••••••••••" : ""}
                  value={adsSettings.developerToken || ""}
                  onChange={(e) => setAdsSettings({ ...adsSettings, developerToken: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.googleAds.clientId")}</Label>
                <Input
                  placeholder={hasAdsClientId ? "••••••••••" : ""}
                  value={adsSettings.clientId || ""}
                  onChange={(e) => setAdsSettings({ ...adsSettings, clientId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.googleAds.clientSecret")}</Label>
                <Input
                  type="password"
                  placeholder={hasAdsClientSecret ? "••••••••••" : ""}
                  value={adsSettings.clientSecret || ""}
                  onChange={(e) => setAdsSettings({ ...adsSettings, clientSecret: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.googleAds.refreshToken")}</Label>
                <Input
                  type="password"
                  placeholder={hasAdsRefreshToken ? "••••••••••" : ""}
                  value={adsSettings.refreshToken || ""}
                  onChange={(e) => setAdsSettings({ ...adsSettings, refreshToken: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("settings.googleAds.loginCustomerId")}</Label>
                <Input
                  value={adsSettings.loginCustomerId || ""}
                  onChange={(e) => setAdsSettings({ ...adsSettings, loginCustomerId: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() =>
                  saveAdsSettingsMutation.mutate({
                    ...adsSettings,
                    customerIdsInput: adsCustomerIdsInput,
                  })
                }
                disabled={saveAdsSettingsMutation.isPending}
              >
                {saveAdsSettingsMutation.isPending
                  ? t("settings.googleAds.saving")
                  : t("settings.googleAds.save")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function AiTab() {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          {t('ai.aiIntegration')}
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t('ai.enableAi')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('ai.enableAiDesc')}
              </p>
            </div>
            <Switch
              checked={aiEnabled}
              onCheckedChange={setAiEnabled}
              data-testid="switch-ai-enabled"
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-sm font-medium">{t("ai.chatProvider")}</Label>
            <Select
              value={chatProvider}
              onValueChange={(v) => setChatProvider(v as "openai" | "anthropic")}
            >
              <SelectTrigger data-testid="select-chat-llm-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">{t("ai.chatProviderOpenAI")}</SelectItem>
                <SelectItem value="anthropic">{t("ai.chatProviderAnthropic")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("ai.chatProviderDesc")}</p>
          </div>

          {chatProvider === "anthropic" ? (
            <div>
              <Label className="text-sm font-medium mb-2">{t("ai.anthropicApiKey")}</Label>
              <div className="relative">
                <Input
                  type={showAnthropicKey ? "text" : "password"}
                  placeholder={
                    aiSettings?.hasAnthropicKey ? "••••••••••••••••••••" : t("ai.anthropicApiKeyPlaceholder")
                  }
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  className="font-mono pr-10"
                  data-testid="input-anthropic-api-key"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                  data-testid="button-toggle-anthropic-key-visibility"
                >
                  {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t("ai.anthropicApiKeyDesc")}</p>
            </div>
          ) : null}

          <div>
            <Label className="text-sm font-medium mb-2">{t("ai.apiKey")}</Label>
            <div className="relative">
              <Input
                type={showOpenaiKey ? "text" : "password"}
                placeholder={aiSettings?.hasApiKey ? "••••••••••••••••••••" : t('ai.apiKeyPlaceholder')}
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                className="font-mono pr-10"
                data-testid="input-openai-api-key"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                data-testid="button-toggle-openai-key-visibility"
              >
                {showOpenaiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {chatProvider === "anthropic" ? t("ai.openaiKeyOptionalDesc") : t('ai.apiKeyDesc')}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {chatProvider === "anthropic" ? (
              <div className="space-y-1">
                <Label className="text-xs">{t("ai.anthropicModel")}</Label>
                <Input
                  className="font-mono text-sm"
                  placeholder="claude-3-5-sonnet-20241022"
                  value={anthropicModel}
                  onChange={(e) => setAnthropicModel(e.target.value)}
                  data-testid="input-anthropic-model"
                />
              </div>
            ) : null}
            <div className="space-y-1">
              <Label className="text-xs">{t("ai.openaiChatModel")}</Label>
              <Input
                className="font-mono text-sm"
                placeholder="gpt-4o-mini"
                value={openaiChatModel}
                onChange={(e) => setOpenaiChatModel(e.target.value)}
                disabled={chatProvider === "anthropic"}
                data-testid="input-openai-chat-model"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button 
              onClick={() => saveAiSettingsMutation.mutate({ 
                apiKey: openaiApiKey || undefined,
                anthropicApiKey: anthropicApiKey || undefined,
                enabled: aiEnabled,
                chatProvider,
                anthropicModel: anthropicModel.trim(),
                openaiChatModel: openaiChatModel.trim(),
              })}
              disabled={saveAiSettingsMutation.isPending}
              data-testid="button-save-ai-settings"
            >
              {saveAiSettingsMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          {t("settings.commercialAgent.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">{t("settings.commercialAgent.description")}</p>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t("settings.commercialAgent.enable")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.enableDesc")}</p>
            </div>
            <Switch
              checked={commercialAgentForm.enabled}
              onCheckedChange={(v) => setCommercialAgentForm((p) => ({ ...p, enabled: v }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t("settings.commercialAgent.documentLearning")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.documentLearningDesc")}</p>
            </div>
            <Switch
              checked={commercialAgentForm.documentLearningEnabled}
              onCheckedChange={(v) =>
                setCommercialAgentForm((p) => ({ ...p, documentLearningEnabled: v }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t("settings.commercialAgent.subAgents")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.subAgentsDesc")}</p>
            </div>
            <Switch
              checked={commercialAgentForm.subAgentsEnabled}
              onCheckedChange={(v) => setCommercialAgentForm((p) => ({ ...p, subAgentsEnabled: v }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t("settings.commercialAgent.webDomainVerify")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.webDomainVerifyDesc")}</p>
            </div>
            <Switch
              checked={commercialAgentForm.webDomainVerifyEnabled}
              onCheckedChange={(v) => setCommercialAgentForm((p) => ({ ...p, webDomainVerifyEnabled: v }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                {t("settings.commercialAgent.extractionRefinementSubAgents")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.commercialAgent.extractionRefinementSubAgentsDesc")}
              </p>
            </div>
            <Switch
              checked={commercialAgentForm.extractionRefinementSubAgentsEnabled}
              onCheckedChange={(v) =>
                setCommercialAgentForm((p) => ({ ...p, extractionRefinementSubAgentsEnabled: v }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t("settings.commercialAgent.signatureCompanyVision")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.signatureCompanyVisionDesc")}</p>
            </div>
            <Switch
              checked={commercialAgentForm.signatureCompanyVisionEnabled}
              onCheckedChange={(v) =>
                setCommercialAgentForm((p) => ({ ...p, signatureCompanyVisionEnabled: v }))
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.commercialAgent.customerMatchAutoMin")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.customerMatchAutoMinDesc")}</p>
              <Input
                type="number"
                min={0}
                max={100}
                className="max-w-[120px]"
                value={commercialAgentForm.customerMatchAutoMinConfidence}
                onChange={(e) =>
                  setCommercialAgentForm((p) => ({
                    ...p,
                    customerMatchAutoMinConfidence: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.commercialAgent.customerAutoCreateMin")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.customerAutoCreateMinDesc")}</p>
              <Input
                type="number"
                min={0}
                max={100}
                className="max-w-[120px]"
                value={commercialAgentForm.customerAutoCreateMinConfidence}
                onChange={(e) =>
                  setCommercialAgentForm((p) => ({
                    ...p,
                    customerAutoCreateMinConfidence: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.commercialAgent.minRankedEmailScore")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.minRankedEmailScoreDesc")}</p>
              <Input
                type="number"
                min={0}
                max={200}
                className="max-w-[120px]"
                value={commercialAgentForm.minRankedEmailScoreForAutoCreate}
                onChange={(e) =>
                  setCommercialAgentForm((p) => ({
                    ...p,
                    minRankedEmailScoreForAutoCreate: Math.min(200, Math.max(0, Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t("settings.commercialAgent.lineItemSixDigitGtinPrefixes")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.lineItemSixDigitGtinPrefixesDesc")}</p>
            <Input
              className="max-w-md font-mono text-sm"
              placeholder="4026212"
              value={commercialAgentForm.lineItemSixDigitGtinPrefixes.join(", ")}
              onChange={(e) =>
                setCommercialAgentForm((p) => ({
                  ...p,
                  lineItemSixDigitGtinPrefixes: e.target.value
                    .split(/[,;\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                }))
              }
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t("settings.commercialAgent.exemplarsMax")}</Label>
            <Input
              type="number"
              min={1}
              max={12}
              className="max-w-[120px]"
              value={commercialAgentForm.exemplarsInPromptMax}
              onChange={(e) =>
                setCommercialAgentForm((p) => ({
                  ...p,
                  exemplarsInPromptMax: Math.min(12, Math.max(1, Number(e.target.value) || 5)),
                }))
              }
            />
          </div>

          {commercialLearningStats !== undefined ? (
            <p className="text-xs text-muted-foreground">
              {t("settings.commercialAgent.learningExemplarsStored", { count: commercialLearningStats.total })}
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.commercialAgent.minIntent")}</Label>
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={commercialAgentForm.autoCreateMinIntentConfidence}
                onChange={(e) =>
                  setCommercialAgentForm((p) => ({
                    ...p,
                    autoCreateMinIntentConfidence: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.commercialAgent.minMatch")}</Label>
              <Input
                type="number"
                step={1}
                min={0}
                max={100}
                value={commercialAgentForm.autoCreateMinMatchConfidence}
                onChange={(e) =>
                  setCommercialAgentForm((p) => ({
                    ...p,
                    autoCreateMinMatchConfidence: Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">{t("settings.commercialAgent.autoOffers")}</Label>
            <Switch
              checked={commercialAgentForm.autoCreateOffersEnabled}
              onCheckedChange={(v) => setCommercialAgentForm((p) => ({ ...p, autoCreateOffersEnabled: v }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">{t("settings.commercialAgent.autoOrders")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.commercialAgent.autoOrdersDesc")}</p>
            </div>
            <Switch
              checked={commercialAgentForm.autoCreateOrdersEnabled}
              onCheckedChange={(v) => setCommercialAgentForm((p) => ({ ...p, autoCreateOrdersEnabled: v }))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("settings.commercialAgent.salesChannelId")}</Label>
            <Input
              value={commercialAgentForm.autoCreateSalesChannelId}
              onChange={(e) =>
                setCommercialAgentForm((p) => ({ ...p, autoCreateSalesChannelId: e.target.value }))
              }
              className="font-mono text-sm"
              placeholder={t("settings.commercialAgent.salesChannelPlaceholder")}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => saveCommercialAgentMutation.mutate(commercialAgentForm)}
              disabled={saveCommercialAgentMutation.isPending}
            >
              {saveCommercialAgentMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          {t("settings.semanticRanking.title")}
        </h2>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("settings.semanticRanking.description")}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.semanticRanking.vectorWeight")}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={rankingSettings.vectorWeight}
                onChange={(e) =>
                  setRankingSettings((prev) => ({ ...prev, vectorWeight: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.semanticRanking.textWeight")}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={rankingSettings.textWeight}
                onChange={(e) =>
                  setRankingSettings((prev) => ({ ...prev, textWeight: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.semanticRanking.metadataWeight")}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={rankingSettings.metadataWeight}
                onChange={(e) =>
                  setRankingSettings((prev) => ({ ...prev, metadataWeight: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.semanticRanking.feedbackWeight")}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={rankingSettings.feedbackWeight}
                onChange={(e) =>
                  setRankingSettings((prev) => ({ ...prev, feedbackWeight: Number(e.target.value) }))
                }
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.semanticRanking.metadataExactBoost")}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={rankingSettings.metadataExactBoost}
                onChange={(e) =>
                  setRankingSettings((prev) => ({ ...prev, metadataExactBoost: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.semanticRanking.metadataPartialBoost")}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={rankingSettings.metadataPartialBoost}
                onChange={(e) =>
                  setRankingSettings((prev) => ({ ...prev, metadataPartialBoost: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("settings.semanticRanking.titleTokenBoost")}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={rankingSettings.titleTokenBoost}
                onChange={(e) =>
                  setRankingSettings((prev) => ({ ...prev, titleTokenBoost: Number(e.target.value) }))
                }
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => saveSemanticRankingMutation.mutate(rankingSettings)}
              disabled={saveSemanticRankingMutation.isPending}
            >
              {saveSemanticRankingMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          {t("settings.aiPrompts.title")}
        </h2>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("settings.aiPrompts.description")}</p>
          <div className="space-y-2">
            <Label className="text-xs">{t("settings.aiPrompts.semanticSearchAddon")}</Label>
            <Textarea
              rows={4}
              value={promptOverrides.semanticSearchSystemAddon}
              onChange={(e) =>
                setPromptOverrides((prev) => ({ ...prev, semanticSearchSystemAddon: e.target.value }))
              }
              placeholder={t("settings.aiPrompts.semanticSearchPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">{t("settings.aiPrompts.faqAddon")}</Label>
            <Textarea
              rows={4}
              value={promptOverrides.faqSystemAddon}
              onChange={(e) => setPromptOverrides((prev) => ({ ...prev, faqSystemAddon: e.target.value }))}
              placeholder={t("settings.aiPrompts.faqPlaceholder")}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => savePromptOverridesMutation.mutate(promptOverrides)}
              disabled={savePromptOverridesMutation.isPending}
            >
              {savePromptOverridesMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}


  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure your Shopware connection and preferences
        </p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="mb-4 flex h-auto flex-wrap gap-1 p-1">
          <TabsTrigger value="general">{t("settings.tabs.general")}</TabsTrigger>
          <TabsTrigger value="shopware">{t("settings.tabs.shopware")}</TabsTrigger>
          <TabsTrigger value="offers">{t("settings.tabs.offers")}</TabsTrigger>
          <TabsTrigger value="tickets">{t("settings.tabs.tickets")}</TabsTrigger>
          <TabsTrigger value="email">{t("settings.tabs.email")}</TabsTrigger>
          <TabsTrigger value="marketing">{t("settings.tabs.marketing")}</TabsTrigger>
          <TabsTrigger value="ai">{t("settings.tabs.ai")}</TabsTrigger>
          <TabsTrigger value="integration">{t("settings.tabs.integration")}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-0">
          <GeneralTab />
        </TabsContent>
        <TabsContent value="shopware" className="mt-0">
          <ShopwareTab />
        </TabsContent>
        <TabsContent value="offers" className="mt-0">
          <OffersTab />
        </TabsContent>
        <TabsContent value="tickets" className="mt-0">
          <TicketsTab />
        </TabsContent>
        <TabsContent value="email" className="mt-0">
          <EmailTab />
        </TabsContent>
        <TabsContent value="marketing" className="mt-0">
          <MarketingTab />
        </TabsContent>
        <TabsContent value="ai" className="mt-0">
          <AiTab />
        </TabsContent>
        <TabsContent value="integration" className="mt-0">
          <N8nSettingsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
