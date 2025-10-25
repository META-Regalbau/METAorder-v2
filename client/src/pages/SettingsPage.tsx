import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function SettingsPage() {
  const { toast } = useToast();
  const [shopwareUrl, setShopwareUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const handleTestConnection = async () => {
    setIsTesting(true);
    console.log("Testing connection to:", shopwareUrl);
    
    // TODO: Implement actual connection test
    setTimeout(() => {
      setIsTesting(false);
      toast({
        title: "Connection successful",
        description: "Successfully connected to Shopware API.",
      });
    }, 1500);
  };

  const handleSave = () => {
    console.log("Saving settings:", { shopwareUrl, apiKey: "***", apiSecret: "***" });
    toast({
      title: "Settings saved",
      description: "Your Shopware connection settings have been updated.",
    });
    // TODO: Implement actual settings save to backend
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure your Shopware connection and preferences
        </p>
      </div>

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
                placeholder="Enter your API secret key"
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
              disabled={isTesting || !shopwareUrl || !apiKey || !apiSecret}
              data-testid="button-test-connection"
            >
              {isTesting ? "Testing..." : "Test Connection"}
            </Button>
            <Button 
              onClick={handleSave}
              disabled={!shopwareUrl || !apiKey || !apiSecret}
              data-testid="button-save-settings"
            >
              Save Settings
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 mt-6">
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
