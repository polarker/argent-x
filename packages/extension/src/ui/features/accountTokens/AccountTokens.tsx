import { CellStack } from "@argent/ui"
import { Flex, VStack } from "@chakra-ui/react"
import { FC, Suspense, useCallback, useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import useSWR from "swr"

import { useKeyValueStorage } from "../../../shared/storage/hooks"
import { userReviewStore } from "../../../shared/userReview"
import {
  getAccountIdentifier,
  isDeprecated,
} from "../../../shared/wallet.service"
import { ErrorBoundary } from "../../components/ErrorBoundary"
import ErrorBoundaryFallbackWithCopyError from "../../components/ErrorBoundaryFallbackWithCopyError"
import { routes } from "../../routes"
import {
  connectAccount,
  redeployAccount,
} from "../../services/backgroundAccounts"
import { withPolling } from "../../services/swr"
import { Account } from "../accounts/Account"
import {
  getAccountName,
  useAccountMetadata,
} from "../accounts/accountMetadata.state"
import { useAccountTransactions } from "../accounts/accountTransactions.state"
import { checkIfUpgradeAvailable } from "../accounts/upgrade.service"
import { useShouldShowNetworkUpgradeMessage } from "../networks/showNetworkUpgrade"
import { useCurrentNetwork } from "../networks/useNetworks"
import { useBackupRequired } from "../recovery/backupDownload.state"
import { RecoveryBanner } from "../recovery/RecoveryBanner"
import { StatusMessageBannerContainer } from "../statusMessage/StatusMessageBanner"
import { AccountTokensButtons } from "./AccountTokensButtons"
import { AccountTokensHeader } from "./AccountTokensHeader"
import { MigrationBanner } from "./MigrationBanner"
import { NewTokenButton, TokenList } from "./TokenList"
import { TokenListMulticall } from "./TokenListMulticall"
import { useCurrencyDisplayEnabled } from "./tokenPriceHooks"
import { useFeeTokenBalance } from "./tokens.service"
import { useTokensWithBalance } from "./tokens.state"
import { UpgradeBanner } from "./UpgradeBanner"
import { useAccountIsDeployed, useAccountStatus } from "./useAccountStatus"

interface AccountTokensProps {
  account: Account
}

export const AccountTokens: FC<AccountTokensProps> = ({ account }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const status = useAccountStatus(account)
  const { pendingTransactions } = useAccountTransactions(account)
  const { accountNames } = useAccountMetadata()
  const { isBackupRequired } = useBackupRequired()
  const currencyDisplayEnabled = useCurrencyDisplayEnabled()
  const transactionsBeforeReview = useKeyValueStorage(
    userReviewStore,
    "transactionsBeforeReview",
  )

  const userHasReviewed = useKeyValueStorage(userReviewStore, "hasReviewed")

  const hasPendingTransactions = pendingTransactions.length > 0
  const accountName = getAccountName(account, accountNames)
  const network = useCurrentNetwork()
  const {
    shouldShow: shouldShowNetworkUpgradeMessage,
    updateLastShown: updateLastShownNetworkUpgradeMessage,
  } = useShouldShowNetworkUpgradeMessage()

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>
    if (!userHasReviewed && transactionsBeforeReview === 0) {
      timeoutId = setTimeout(() => navigate(routes.userReview()), 1000)
    }
    return () => timeoutId && clearTimeout(timeoutId)
  }, [navigate, transactionsBeforeReview, userHasReviewed])

  const { feeTokenBalance } = useFeeTokenBalance(account)

  const { isValidating, error, tokenDetails, tokenDetailsIsInitialising } =
    useTokensWithBalance(account)

  const { data: needsUpgrade = false, mutate } = useSWR(
    [
      getAccountIdentifier(account),
      network.accountClassHash,
      "showUpgradeBanner",
    ],
    () => checkIfUpgradeAvailable(account, network.accountClassHash),
    { suspense: false, ...withPolling(60 * 1000) },
  )

  const onRedeploy = useCallback(async () => {
    const data = account.toBaseWalletAccount()
    try {
      const result = await redeployAccount(data)
      account.updateDeployTx(result.txHash)
    } catch {
      // ignore, account should enter error state and failure will be actionable elsewhere in UI
    }
  }, [account])

  const showUpgradeBanner = Boolean(
    needsUpgrade && !hasPendingTransactions && feeTokenBalance?.gt(0),
  )
  const showNoBalanceForUpgrade = Boolean(
    needsUpgrade && !hasPendingTransactions && feeTokenBalance?.lte(0),
  )

  const showBackupBanner = isBackupRequired && !showUpgradeBanner

  const hadPendingTransactions = useRef(false)
  useEffect(() => {
    if (hasPendingTransactions) {
      hadPendingTransactions.current = true
    }
    if (hadPendingTransactions.current && hasPendingTransactions === false) {
      // switched from true to false
      hadPendingTransactions.current = false
      mutate(false) // update upgrade banner
    }
  }, [mutate, hasPendingTransactions])

  useEffect(() => {
    connectAccount(account)
  }, [account])

  useEffect(() => {
    if (shouldShowNetworkUpgradeMessage) {
      updateLastShownNetworkUpgradeMessage()
      navigate(routes.networkUpgradeV4())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowNetworkUpgradeMessage])

  const tokenListVariant = currencyDisplayEnabled ? "default" : "no-currency"
  const accountIsDeployed = useAccountIsDeployed(account)
  return (
    <Flex direction={"column"} data-testid="account-tokens">
      <VStack spacing={6} mb={6}>
        <AccountTokensHeader
          status={status}
          account={account}
          accountName={accountName}
          onRedeploy={onRedeploy}
        />
        <AccountTokensButtons account={account} />
      </VStack>
      <CellStack py={0}>
        <StatusMessageBannerContainer />
        {isDeprecated(account) && <MigrationBanner />}
        {showBackupBanner && <RecoveryBanner />}
        {showUpgradeBanner && (
          <UpgradeBanner
            to={routes.accountUpgradeV4()}
            state={{ from: location.pathname }}
          />
        )}
        {showNoBalanceForUpgrade && (
          <UpgradeBanner canNotPay to={routes.funding()} />
        )}
        <TokenListMulticall variant={tokenListVariant} showNewTokenButton />
      </CellStack>
      {/** TODO: remove this extra error boundary once TokenList issues are settled */}
      {accountIsDeployed && (
        <ErrorBoundary
          fallback={
            <ErrorBoundaryFallbackWithCopyError
              message={"Sorry, an error occurred fetching tokens"}
            />
          }
        >
          {error ? (
            <ErrorBoundaryFallbackWithCopyError
              error={error}
              message={"Sorry, an error occurred fetching tokens"}
            />
          ) : (
            <TokenList
              showTitle={hasPendingTransactions}
              isValidating={isValidating}
              tokenList={tokenDetails}
              variant={tokenListVariant}
            >
              <NewTokenButton isLoading={tokenDetailsIsInitialising} />
            </TokenList>
          )}
        </ErrorBoundary>
      )}
    </Flex>
  )
}
