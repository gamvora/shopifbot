import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SpinWheel } from "@/components/SpinWheel";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Gift, 
  Flame, 
  Users, 
  Copy, 
  Check, 
  Share2,
  Sparkles,
  Calendar,
  Trophy,
  Star,
  Ticket,
  Home as HomeIcon,
  User,
  Settings as SettingsIcon,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const SPIN_PRIZES = [20, 30, 40, 60, 85, 110];

const STREAK_REWARDS: { [key: number]: number } = {
  1: 30, 3: 45, 7: 70, 14: 110, 30: 210
};

export default function Rewards() {
  const { toast } = useToast();
  const [referralInput, setReferralInput] = useState("");
  const [redeemInput, setRedeemInput] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: spinStatus, isLoading: spinLoading, refetch: refetchSpin } = useQuery<{ canSpin: boolean; lastSpin?: any }>({
    queryKey: ["/api/spin/status"],
    retry: 2,
  });

  const { data: streakStatus, isLoading: streakLoading, refetch: refetchStreak } = useQuery<{ 
    currentStreak: number; 
    longestStreak: number; 
    lastClaimDate?: string;
    totalClaimed: number;
    canClaim: boolean;
  }>({
    queryKey: ["/api/streak/status"],
    retry: 2,
  });

  const { data: referralCode, isLoading: referralLoading } = useQuery<{ code: string }>({
    queryKey: ["/api/referral/code"],
    retry: 2,
  });

  const { data: referralStats } = useQuery<{ count: number; totalCredits: number; referrals: any[] }>({
    queryKey: ["/api/referral/stats"],
    retry: 2,
  });

  const spinMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/spin");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "You won!",
        description: `+${data.creditsWon} credits added to your balance!`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/spin/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to spin",
        variant: "destructive",
      });
    },
  });

  const streakMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/streak/claim");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Streak Claimed!",
        description: `+${data.reward} credits! Day ${data.currentStreak} streak!`,
      });
      refetchStreak();
      queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to claim streak",
        variant: "destructive",
      });
    },
  });

  const applyReferralMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/referral/apply", { code });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Referral Applied!",
        description: `+${data.creditsEarned} credits welcome bonus!`,
      });
      setReferralInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Invalid referral code",
        variant: "destructive",
      });
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/redeem", { code });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Code Redeemed!",
        description: `+${data.credits} credits added to your balance!`,
      });
      setRedeemInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Invalid code",
        variant: "destructive",
      });
    },
  });

  const handleSpin = async () => {
    const result = await spinMutation.mutateAsync();
    return result;
  };

  const copyReferralCode = () => {
    if (referralCode?.code) {
      navigator.clipboard.writeText(referralCode.code);
      setCopied(true);
      toast({ title: "Copied!", description: "Referral code copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareReferral = () => {
    const text = `Join NexusChecker and get 50 bonus credits! Use my referral code: ${referralCode?.code}`;
    if (navigator.share) {
      navigator.share({ text });
    } else {
      navigator.clipboard.writeText(text);
      toast({ title: "Copied!", description: "Referral message copied to clipboard" });
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 pb-24" data-testid="rewards-page">
      <div className="max-w-md mx-auto space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6"
        >
          <h1 className="text-2xl font-bold flex items-center justify-center gap-2">
            <Gift className="w-6 h-6 text-purple-500" />
            Daily Rewards
          </h1>
          <p className="text-muted-foreground text-sm">Earn free credits every day!</p>
        </motion.div>

        <Tabs defaultValue="spin" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="spin" className="flex items-center gap-1" data-testid="tab-spin">
              <Gift className="w-4 h-4" />
              Spin
            </TabsTrigger>
            <TabsTrigger value="streak" className="flex items-center gap-1" data-testid="tab-streak">
              <Flame className="w-4 h-4" />
              Streak
            </TabsTrigger>
            <TabsTrigger value="referral" className="flex items-center gap-1" data-testid="tab-referral">
              <Users className="w-4 h-4" />
              Referral
            </TabsTrigger>
            <TabsTrigger value="redeem" className="flex items-center gap-1" data-testid="tab-redeem">
              <Ticket className="w-4 h-4" />
              Redeem
            </TabsTrigger>
          </TabsList>

          <TabsContent value="spin" className="mt-4">
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2">
                  <Sparkles className="w-5 h-5 text-yellow-500" />
                  Daily Spin Wheel
                </CardTitle>
                <CardDescription>
                  Spin once daily for free credits!
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center">
                <SpinWheel
                  prizes={SPIN_PRIZES}
                  onSpin={handleSpin}
                  canSpin={spinLoading ? undefined : spinStatus?.canSpin ?? true}
                  isSpinning={spinMutation.isPending}
                  isLoading={spinLoading}
                />
                
                <div className="mt-4 text-center text-sm text-muted-foreground">
                  <p>Prizes: {SPIN_PRIZES.join(", ")} credits</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="streak" className="mt-4">
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2">
                  <Flame className="w-5 h-5 text-orange-500" />
                  Daily Streak
                </CardTitle>
                <CardDescription>
                  Claim daily for increasing rewards!
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-center items-center gap-4">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-orange-500">
                      {streakStatus?.currentStreak || 0}
                    </div>
                    <div className="text-sm text-muted-foreground">Current Streak</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-semibold text-muted-foreground">
                      {streakStatus?.longestStreak || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Best</div>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(STREAK_REWARDS).map(([day, reward]) => {
                    const dayNum = parseInt(day);
                    const isAchieved = (streakStatus?.currentStreak || 0) >= dayNum;
                    return (
                      <div
                        key={day}
                        className={cn(
                          "p-2 rounded-lg text-center border",
                          isAchieved 
                            ? "bg-orange-500/20 border-orange-500/50" 
                            : "bg-muted/50 border-border"
                        )}
                      >
                        <div className="text-xs text-muted-foreground">Day {day}</div>
                        <div className={cn(
                          "font-bold text-sm",
                          isAchieved ? "text-orange-500" : "text-foreground"
                        )}>
                          {reward}
                        </div>
                        {isAchieved && <Star className="w-3 h-3 mx-auto text-orange-500" />}
                      </div>
                    );
                  })}
                </div>

                <Button
                  onClick={() => streakMutation.mutate()}
                  disabled={!streakStatus?.canClaim || streakMutation.isPending}
                  className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
                  data-testid="button-claim-streak"
                >
                  {streakMutation.isPending ? (
                    "Claiming..."
                  ) : streakStatus?.canClaim ? (
                    <span className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Claim Daily Reward
                    </span>
                  ) : (
                    "Already Claimed Today"
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="referral" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-green-500" />
                  Your Referral Code
                </CardTitle>
                <CardDescription>
                  Share and earn 100 credits for each new user!
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-lg px-4 py-3 font-mono text-lg text-center">
                    {referralLoading ? (
                      <span className="text-muted-foreground animate-pulse">Loading...</span>
                    ) : referralCode?.code ? (
                      <span className="text-green-400 font-bold">{referralCode.code}</span>
                    ) : (
                      <span className="text-muted-foreground">Error loading code</span>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={copyReferralCode}
                    data-testid="button-copy-referral"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={shareReferral}
                    data-testid="button-share-referral"
                  >
                    <Share2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <div>
                    <div className="text-sm text-muted-foreground">Total Referrals</div>
                    <div className="text-2xl font-bold text-green-500">
                      {referralStats?.count || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Credits Earned</div>
                    <div className="text-2xl font-bold text-green-500">
                      {referralStats?.totalCredits || 0}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Have a Referral Code?</CardTitle>
                <CardDescription>
                  Enter a code to get 50 bonus credits (new users only)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter code..."
                    value={referralInput}
                    onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
                    className="font-mono"
                    data-testid="input-referral-code"
                  />
                  <Button
                    onClick={() => applyReferralMutation.mutate(referralInput)}
                    disabled={!referralInput || applyReferralMutation.isPending}
                    data-testid="button-apply-referral"
                  >
                    Apply
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="redeem" className="mt-4">
            <Card className="relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500" />
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2">
                  <Ticket className="w-5 h-5 text-purple-500" />
                  Redeem Code
                </CardTitle>
                <CardDescription>
                  Enter a promo code to instantly add free credits to your balance
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-center p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">Fun Fact</div>
                    <div className="text-sm font-medium mt-1">
                      Each code is single-use and can only be claimed by one person
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter code... e.g. ABCD-EFGH"
                    value={redeemInput}
                    onChange={(e) => setRedeemInput(e.target.value.toUpperCase())}
                    className="font-mono"
                    data-testid="input-redeem-code"
                  />
                  <Button
                    onClick={() => redeemMutation.mutate(redeemInput)}
                    disabled={!redeemInput || redeemMutation.isPending}
                    className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/20 border-0"
                    data-testid="button-redeem-code"
                  >
                    {redeemMutation.isPending ? "Redeeming..." : "Redeem"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur-xl border-t border-border px-4 py-3 z-50">
        <div className="flex items-center justify-around max-w-md mx-auto">
          <Link href="/">
            <button 
              className="flex flex-col items-center gap-1.5 py-1 px-6"
              data-testid="nav-home"
            >
              <div className="p-2">
                <HomeIcon className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">Home</span>
            </button>
          </Link>
          <Link href="/rewards">
            <button 
              className="flex flex-col items-center gap-1.5 py-1 px-6"
              data-testid="nav-rewards"
            >
              <div className="p-2 rounded-xl bg-purple-500/10">
                <Gift className="w-5 h-5 text-purple-500" />
              </div>
              <span className="text-[10px] font-semibold text-purple-500">Rewards</span>
            </button>
          </Link>
          <Link href="/profile">
            <button 
              className="flex flex-col items-center gap-1.5 py-1 px-6"
              data-testid="nav-profile"
            >
              <div className="p-2">
                <User className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">Profile</span>
            </button>
          </Link>
          <Link href="/settings">
            <button 
              className="flex flex-col items-center gap-1.5 py-1 px-6"
              data-testid="nav-settings"
            >
              <div className="p-2">
                <SettingsIcon className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">Settings</span>
            </button>
          </Link>
        </div>
      </nav>
    </div>
  );
}