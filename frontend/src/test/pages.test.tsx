import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import batch from "./fixtures/batch.json";
import curve from "./fixtures/curve.json";
import modelInfo from "./fixtures/model-info.json";
import overview from "./fixtures/overview.json";
import predict from "./fixtures/predict-fraud.json";
import samples from "./fixtures/samples.json";
import threshold from "./fixtures/threshold.json";
import { ApiError, api } from "../lib/api";
import App from "../App";

vi.mock("../lib/api", async (orig) => {
  const actual = await orig<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      health: vi.fn(),
      modelInfo: vi.fn(),
      overview: vi.fn(),
      samples: vi.fn(),
      threshold: vi.fn(),
      curve: vi.fn(),
      predict: vi.fn(),
      predictBatch: vi.fn(),
      sampleCsv: vi.fn(),
    },
  };
});

const mocked = api as unknown as Record<keyof typeof api, ReturnType<typeof vi.fn>>;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
  mocked.modelInfo.mockResolvedValue(modelInfo);
  mocked.overview.mockResolvedValue(overview);
  mocked.samples.mockResolvedValue(samples);
  mocked.threshold.mockImplementation((t: number) => Promise.resolve({ ...threshold, threshold: t }));
  mocked.curve.mockResolvedValue(curve);
  mocked.predict.mockResolvedValue(predict);
  mocked.predictBatch.mockResolvedValue(batch);
});
afterEach(() => vi.clearAllMocks());

describe("landing", () => {
  it("shows the headline, CTAs and real figures without any sign-in", async () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1, name: /catch more fraud/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /check a transaction/i })[0]).toHaveAttribute("href", "/check");
    expect((await screen.findAllByText("€4,495")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/sign in|log in|password|sign up/i)).toBeNull();
  });
});

describe("dashboard", () => {
  it("loads real metrics and updates when the threshold changes", async () => {
    renderAt("/dashboard");
    expect(await screen.findByRole("heading", { name: /fraud overview/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("kpi-net")).toHaveTextContent("€4,495.14"));
    expect(mocked.threshold).toHaveBeenCalledWith(0.26, expect.anything(), "test", expect.anything());
    const box = screen.getAllByLabelText("Threshold value")[0];
    await userEvent.clear(box);
    await userEvent.type(box, "0.7{enter}");
    await waitFor(() => expect(mocked.threshold).toHaveBeenCalledWith(0.7, expect.anything(), "test", expect.anything()));
    expect(screen.getByText(/gross caught amount is not "money saved"/i)).toBeInTheDocument();
  });

  it("shows an error state with retry when the API is down", async () => {
    mocked.modelInfo.mockRejectedValue(new ApiError("network", "Can't reach the FraudLens server."));
    renderAt("/dashboard");
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't reach/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

describe("check page", () => {
  it("scores a sample, explains it and stores session history", async () => {
    renderAt("/check");
    const amount = await screen.findByLabelText("Amount (€)");
    await waitFor(() => expect(amount).toHaveValue("349.08"));
    await userEvent.click(screen.getByRole("button", { name: /check transaction/i }));
    expect(await screen.findByText(/why this decision/i)).toBeInTheDocument();
    expect(await screen.findByText("+5.38")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download report/i })).toBeInTheDocument();
    expect(screen.getByText(/€314\.17/)).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("fraudlens.history.v1") ?? "[]")).toHaveLength(1);
    expect(mocked.predict.mock.calls[0][1]).toBe(0.26);
  });

  it("blocks submission with invalid input and does not call the API", async () => {
    renderAt("/check");
    const amount = await screen.findByLabelText("Amount (€)");
    await waitFor(() => expect(amount).toHaveValue("349.08"));
    await userEvent.clear(amount);
    await userEvent.type(amount, "-10");
    await userEvent.click(screen.getByRole("button", { name: /check transaction/i }));
    expect(await screen.findByText(/use 0 to 100,000/i)).toBeInTheDocument();
    expect(mocked.predict).not.toHaveBeenCalled();
  });

  it("shows a review warning for borderline scores", async () => {
    mocked.predict.mockResolvedValue({
      ...predict,
      prediction: { ...predict.prediction, score: 0.3, review_recommended: true, review_reason: "The score is close to the threshold." },
    });
    renderAt("/check");
    await waitFor(() => expect(screen.getByLabelText("Amount (€)")).toHaveValue("349.08"));
    await userEvent.click(screen.getByRole("button", { name: /check transaction/i }));
    expect(await screen.findByText(/human review recommended/i)).toBeInTheDocument();
  });
});

describe("batch page", () => {
  it("loads the sample CSV, scores it and offers a download", async () => {
    const order = modelInfo.features.order;
    const t = samples.samples[0].features as Record<string, number>;
    mocked.sampleCsv.mockResolvedValue(`transaction_id,${order.join(",")}\na1,${order.map((f) => t[f]).join(",")}\n`);
    renderAt("/batch");
    await userEvent.click(await screen.findByRole("button", { name: /use sample batch/i }));
    expect(await screen.findByText(/1 valid transactions ready/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /score batch/i }));
    expect(await screen.findByRole("button", { name: /download results csv/i })).toBeInTheDocument();
    expect(screen.getByText(/not money saved/i)).toBeInTheDocument();
    expect(mocked.predictBatch.mock.calls[0][0][0].transaction_id).toBe("a1");
  });
});

describe("model page", () => {
  it("shows comparison, dataset license and limitations", async () => {
    renderAt("/model");
    expect(await screen.findByText(/model comparison/i)).toBeInTheDocument();
    expect(screen.getByText(/Database Contents License/)).toBeInTheDocument();
    expect(screen.getByText(/fraud patterns change over time/i)).toBeInTheDocument();
  });
});
