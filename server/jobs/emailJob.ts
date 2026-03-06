export const emailJob = async (payload: any) => {
  console.log("Sending email to:", payload.to);
    //just testing out the job processing, simulating email sending with a delay
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log("Email sent");
};