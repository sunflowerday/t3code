import SwiftUI

/// Dummy host so XCUITest has a runner. Tests attach to the already-installed
/// Release `com.example.kuca.dev` and must never install this over Kuca.
@main
struct KucaUITestHostApp: App {
  var body: some Scene {
    WindowGroup {
      Text("Kuca UITest host")
        .padding()
    }
  }
}
