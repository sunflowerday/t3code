import XCTest

/// UI tests attach to the already-installed personal-team Release app.
/// They do not build or install Kuca. Destination must be the wired device.
final class KucaAcceptanceTests: XCTestCase {
  static let kucaBundleId = "com.example.kuca.dev"
  static let longestThreadTitle = "我本地的ssh连接到的机器是什么,请你帮我链接一下"
  static let listBudgetSec: TimeInterval = 2.0
  static let threadBudgetSec: TimeInterval = 3.0

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testLaunchShowsThreadList() throws {
    let app = XCUIApplication(bundleIdentifier: Self.kucaBundleId)
    let started = Date()
    app.launch()
    let appeared = waitForThreadList(in: app, timeout: 30)
    let elapsed = Date().timeIntervalSince(started)
    attachScreenshot(app, name: "thread-list")
    record(
      name: "cold-start-thread-list",
      passed: appeared && elapsed <= Self.listBudgetSec,
      elapsedSec: elapsed,
      detail: appeared
        ? "thread list visible"
        : "thread list did not appear",
    )
    XCTAssertTrue(appeared, "session list never appeared")
    XCTAssertLessThanOrEqual(
      elapsed,
      Self.listBudgetSec,
      "session list appeared in \(elapsed)s, budget \(Self.listBudgetSec)s",
    )
    XCTAssertNotEqual(app.state, .notRunning, "Kuca process died after launch")
  }

  func testOpenLongestThreadFirstScreen() throws {
    let app = XCUIApplication(bundleIdentifier: Self.kucaBundleId)
    app.launch()
    XCTAssertTrue(waitForThreadList(in: app, timeout: 30), "session list never appeared")

    let search = app.descendants(matching: .any)["Search threads"].firstMatch
    if search.waitForExistence(timeout: 5) {
      search.tap()
      search.typeText(Self.longestThreadTitle)
    }

    let row = app.descendants(matching: .any)[Self.longestThreadTitle].firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "1051-message thread row not found")

    let started = Date()
    row.tap()
    let firstScreen = firstScreenAppeared(in: app, timeout: 15)
    let elapsed = Date().timeIntervalSince(started)
    attachScreenshot(app, name: "longest-thread-first-screen")
    record(
      name: "open-1051-first-screen",
      passed: firstScreen && elapsed <= Self.threadBudgetSec,
      elapsedSec: elapsed,
      detail: firstScreen
        ? "first screen visible"
        : "first screen did not appear",
    )
    XCTAssertTrue(firstScreen, "first screen of the 1051-message thread never appeared")
    XCTAssertLessThanOrEqual(
      elapsed,
      Self.threadBudgetSec,
      "first screen appeared in \(elapsed)s, budget \(Self.threadBudgetSec)s",
    )
    XCTAssertNotEqual(app.state, .notRunning)
  }

  func testSearchDoesNotCrash() throws {
    let app = XCUIApplication(bundleIdentifier: Self.kucaBundleId)
    app.launch()
    XCTAssertTrue(waitForThreadList(in: app, timeout: 30))
    let search = app.descendants(matching: .any)["Search threads"].firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "Search threads control missing")
    search.tap()
    search.typeText("ssh")
    attachScreenshot(app, name: "search")
    record(
      name: "search-no-crash",
      passed: app.state != .notRunning,
      elapsedSec: 0,
      detail: "process state \(String(describing: app.state.rawValue))",
    )
    XCTAssertNotEqual(app.state, .notRunning, "Kuca died during search")
  }

  func testApprovalCardIfPresent() throws {
    let app = XCUIApplication(bundleIdentifier: Self.kucaBundleId)
    app.launch()
    let card = app.staticTexts["Approval needed"]
    let present = card.waitForExistence(timeout: 8)
    attachScreenshot(app, name: "approval")
    if !present {
      record(
        name: "approval",
        passed: true,
        elapsedSec: 0,
        detail: "unavailable: no Approval needed card on screen",
      )
      throw XCTSkip("no pending approval on this device; do not invent one")
    }
    let allowOnce = app.staticTexts["Allow once"]
    XCTAssertTrue(allowOnce.waitForExistence(timeout: 3))
    allowOnce.tap()
    let gone = !card.waitForExistence(timeout: 8)
    record(
      name: "approval",
      passed: gone && app.state != .notRunning,
      elapsedSec: 0,
      detail: gone ? "card dismissed" : "card still visible",
    )
    XCTAssertTrue(gone, "Approval needed still visible after Allow once")
    XCTAssertNotEqual(app.state, .notRunning)
  }

  func testFatalErrorScreenFromProbeArgument() throws {
    let app = XCUIApplication(bundleIdentifier: Self.kucaBundleId)
    app.launchArguments.append("--t3-fatal-probe")
    app.launch()
    let banner = app.staticTexts["Something went wrong"]
    let alert = app.alerts.element
    let shown = banner.waitForExistence(timeout: 15) || alert.waitForExistence(timeout: 2)
    attachScreenshot(app, name: "fatal-probe")
    let messageVisible = app.staticTexts["t3-fatal-probe"].waitForExistence(timeout: 2)
      || alert.staticTexts["t3-fatal-probe"].waitForExistence(timeout: 1)
    record(
      name: "fatal-probe-on-screen",
      passed: shown && app.state != .notRunning,
      elapsedSec: 0,
      detail: messageVisible ? "t3-fatal-probe visible" : "fatal chrome visible",
    )
    XCTAssertTrue(shown, "fatal chrome did not appear")
    XCTAssertNotEqual(app.state, .notRunning, "process died instead of showing the fatal screen")
  }

  private func waitForThreadList(in app: XCUIApplication, timeout: TimeInterval) -> Bool {
    let search = app.descendants(matching: .any)["Search threads"]
    let title = app.staticTexts["Threads"]
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.staticTexts["Loading threads..."].exists || app.staticTexts["Syncing threads..."].exists {
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        continue
      }
      if search.firstMatch.exists || title.exists {
        return true
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    }
    return search.firstMatch.exists || title.exists
  }

  private func firstScreenAppeared(in app: XCUIApplication, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.staticTexts["Syncing messages..."].exists {
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        continue
      }
      if app.textViews.firstMatch.exists || app.textFields.firstMatch.exists {
        return true
      }
      if app.staticTexts.matching(NSPredicate(format: "label.length > 8")).count > 2 {
        return true
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    }
    return false
  }

  private func attachScreenshot(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func record(name: String, passed: Bool, elapsedSec: TimeInterval, detail: String) {
    let payload: [String: Any] = [
      "name": name,
      "passed": passed,
      "elapsed_sec": elapsedSec,
      "detail": detail,
      "bundle_id": Self.kucaBundleId,
    ]
    guard
      let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
      let line = String(data: data, encoding: .utf8)
    else {
      return
    }
    print("KUCA_RESULT \(line)")
    let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
    attachment.name = "kuca-result-\(name)"
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
