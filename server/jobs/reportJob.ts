export const reportJob = async (payload: any) => {
  console.log("Generating report:", payload.type);
    //just testing out the job processing, simulating report generation with a delay
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("Report generated");
};